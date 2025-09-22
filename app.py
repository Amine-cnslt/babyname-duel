from __future__ import annotations

from werkzeug.security import generate_password_hash, check_password_hash

"""
Flask server for BabyName Duel (MySQL path)
- Serves the built SPA from /dist (when present)
- Provides REST API for sessions, members, lists, scores, tiebreaks
- Config via environment variables (export from .env.local before running)

Required env:
  DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME
Optional:
  ALLOWED_ORIGIN=http://localhost:5173  (CORS for /api/*)
"""

import json
import os
import re
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Text,
    ForeignKey, UniqueConstraint, text as sql_text, func, inspect, Boolean
)
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session, relationship
from dotenv import load_dotenv
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

# Load .env.local using an absolute path (more reliable than relative cwd)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env.local")
if os.path.exists(ENV_PATH):
    load_dotenv(dotenv_path=ENV_PATH, override=False)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Example: mysql+pymysql://bnd_user:***@127.0.0.1:3306/bnd"
    )

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")

# ----------------------------------------------------------------------------
# App & Config
# ----------------------------------------------------------------------------

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
app = Flask(__name__, static_folder="dist", static_url_path="/")

@app.route("/api/test", methods=["GET"])
def test_api():
    return {"message": "Flask backend is working!"}, 200

raw_origins = os.getenv("ALLOWED_ORIGIN", "*")
if raw_origins.strip() == "*":
    allowed_origins = "*"
else:
    allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

# ----------------------------------------------------------------------------
# Database
# ----------------------------------------------------------------------------

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False))

Base = declarative_base()


def ensure_schema():
    inspector = inspect(engine)
    with engine.begin() as conn:
        session_cols = {col['name'] for col in inspector.get_columns('sessions')}
        if 'max_names' not in session_cols:
            conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN max_names INTEGER DEFAULT 10'))
        if 'invites_locked' not in session_cols:
            conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN invites_locked INTEGER DEFAULT 0'))
        if 'name_focus' not in session_cols:
            conn.execute(sql_text("ALTER TABLE sessions ADD COLUMN name_focus VARCHAR(16) DEFAULT 'mix'"))
        conn.execute(sql_text('UPDATE sessions SET max_names = 10 WHERE max_names IS NULL OR max_names < 5'))
        conn.execute(sql_text('UPDATE sessions SET invites_locked = 0 WHERE invites_locked IS NULL'))
        conn.execute(sql_text("UPDATE sessions SET name_focus = 'mix' WHERE name_focus IS NULL OR name_focus = ''"))
    if not inspector.has_table('owner_list_states'):
        OwnerListState.__table__.create(bind=engine, checkfirst=True)
    if not inspector.has_table('messages'):
        Message.__table__.create(bind=engine, checkfirst=True)
    if not inspector.has_table('notifications'):
        Notification.__table__.create(bind=engine, checkfirst=True)


def seed_owner_states():
    with engine.begin() as conn:
        conn.execute(sql_text(
            """
            INSERT INTO owner_list_states (session_id, owner_uid, status, updated_at)
            SELECT m.session_id, m.uid, 'draft', CURRENT_TIMESTAMP
            FROM members m
            LEFT JOIN owner_list_states s
              ON s.session_id = m.session_id AND s.owner_uid = m.uid
            WHERE m.role IN ('owner', 'voter', 'participant') AND s.session_id IS NULL
            """
        ))

def now_utc():
    # naive UTC datetime stored in DB
    return datetime.utcnow()

EMAIL_REGEX = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


def _uuid() -> str:
    return uuid4().hex


def _is_valid_email(value: str) -> bool:
    if not value or len(value) > 320:
        return False
    return EMAIL_REGEX.match(value) is not None


def _normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def _isoformat(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(microsecond=0).isoformat() + "Z"
    return str(value)


def _create_notification(db, *, user_email: str, session_id: Optional[str], type_: str, payload: Optional[dict] = None):
    if not user_email:
        return None
    note = Notification(
        user_email=user_email,
        session_id=session_id,
        type=type_,
        payload=json.dumps(payload, ensure_ascii=True) if payload else None,
    )
    db.add(note)
    return note


def _serialize_notification(note: Notification) -> dict:
    payload = None
    if note.payload:
        try:
            payload = json.loads(note.payload)
        except json.JSONDecodeError:
            payload = {"raw": note.payload}
    return {
        "id": note.id,
        "sessionId": note.session_id,
        "type": note.type,
        "payload": payload,
        "readAt": _isoformat(note.read_at),
        "createdAt": _isoformat(note.created_at),
    }


def _serialize_message(message: Message) -> dict:
    return {
        "id": message.id,
        "sessionId": message.session_id,
        "sender": message.sender_uid,
        "recipient": message.recipient_uid,
        "body": message.body,
        "kind": message.kind,
        "createdAt": _isoformat(message.created_at),
    }

# --- NEW User model ---
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(320), nullable=False, unique=True, index=True)
    display_name = Column(String(120), nullable=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

class ResetToken(Base):
    __tablename__ = "reset_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(36), nullable=False, unique=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    user = relationship("User")

# ---------------- Models -----------------

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(36), primary_key=True)  # uuid hex
    title = Column(String(200), nullable=False)
    created_by = Column(String(64), nullable=False)
    max_owners = Column(Integer, nullable=False, default=2)
    max_names = Column(Integer, nullable=False, default=10)
    name_focus = Column(String(16), nullable=False, default="mix")
    status = Column(String(16), nullable=False, default="active")
    invite_owner_token = Column(String(64), nullable=False)
    invite_voter_token = Column(String(64), nullable=False)
    invites_locked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    members = relationship("Member", back_populates="session", cascade="all, delete-orphan")
    lists = relationship("ListItem", back_populates="session", cascade="all, delete-orphan")
    scores = relationship("Score", back_populates="session", cascade="all, delete-orphan")
    invites = relationship("SessionInvite", back_populates="session", cascade="all, delete-orphan")
    owner_states = relationship("OwnerListState", back_populates="session", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")

class Member(Base):
    __tablename__ = "members"

    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    uid = Column(String(64), primary_key=True)
    role = Column(String(16), nullable=False)  # owner | voter
    joined_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="members")

class ListItem(Base):
    __tablename__ = "list_items"

    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    owner_uid = Column(String(64), primary_key=True)
    name = Column(String(100), primary_key=True)
    self_rank = Column(Integer, nullable=False)  # 1-10
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="lists")

class Score(Base):
    __tablename__ = "scores"

    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    list_owner_uid = Column(String(64), primary_key=True)
    rater_uid = Column(String(64), primary_key=True)
    name = Column(String(100), primary_key=True)
    score_value = Column(Integer, nullable=False)  # 1-10
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="scores")


class SessionInvite(Base):
    __tablename__ = "session_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False, index=True)
    email = Column(String(320), nullable=False)
    role = Column(String(16), nullable=False)
    token = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="invites")


class OwnerListState(Base):
    __tablename__ = "owner_list_states"

    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    owner_uid = Column(String(64), primary_key=True)
    status = Column(String(16), nullable=False, default="draft")
    updated_at = Column(DateTime, default=now_utc, nullable=False)
    submitted_at = Column(DateTime, nullable=True)

    session = relationship("Session", back_populates="owner_states")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False, index=True)
    sender_uid = Column(String(64), nullable=False)
    recipient_uid = Column(String(64), nullable=True)
    body = Column(Text, nullable=False)
    kind = Column(String(16), nullable=False, default="message")  # message | nudge
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="messages")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_email = Column(String(320), nullable=False, index=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    type = Column(String(32), nullable=False)
    payload = Column(Text, nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session")


ensure_schema()
seed_owner_states()


def _ensure_owner_list_state(db, session_id: str, uid: str):
    if not uid:
        return None
    state = db.query(OwnerListState).filter_by(session_id=session_id, owner_uid=uid).first()
    if not state:
        state = OwnerListState(session_id=session_id, owner_uid=uid, status="draft", updated_at=now_utc())
        db.add(state)
        db.flush()
    return state


def _session_member_role(raw_role: Optional[str]) -> str:
    role = (raw_role or "participant").strip().lower()
    if role == "owner":
        return "owner"
    # normalize legacy labels
    if role in {"participant", "voter"}:
        return "participant"
    return "participant"


def _compute_invite_origin(request_obj) -> str:
    origin_header = request_obj.headers.get("Origin")
    env_origin = os.getenv("ALLOWED_ORIGIN")
    if origin_header:
        return origin_header.rstrip("/")
    if env_origin and env_origin.strip() and env_origin.strip() != "*":
        return env_origin.split(",")[0].strip().rstrip("/")
    return request_obj.host_url.rstrip("/")


def _invite_participants(db, *, session: Session, owner_email: str, invite_specs, origin: str):
    if not invite_specs:
        return []

    results = []
    session_id = session.id

    for spec in invite_specs:
        invite_email = _normalize_email(spec.get("email")) if isinstance(spec, dict) else _normalize_email(spec)
        if not invite_email or invite_email == owner_email:
            continue

        role = _session_member_role(spec.get("role") if isinstance(spec, dict) else None)
        if role == "owner":
            # only one owner – skip silently
            continue

        existing_member = _ensure_member(db, session_id, invite_email)
        user_exists = db.query(User.id).filter_by(email=invite_email).scalar() is not None
        if existing_member:
            results.append({
                "email": invite_email,
                "status": "already-member",
                "existingUser": user_exists,
                "link": None,
            })
            continue

        if user_exists:
            db.add(Member(session_id=session_id, uid=invite_email, role="participant"))
            _ensure_owner_list_state(db, session_id, invite_email)
            # remove any pending invite tokens for cleanliness
            db.query(SessionInvite).filter_by(session_id=session_id, email=invite_email).delete()
            results.append({
                "email": invite_email,
                "status": "added",
                "existingUser": True,
                "link": None,
            })
            _create_notification(
                db,
                user_email=invite_email,
                session_id=session_id,
                type_="session_invite",
                payload={
                    "sid": session_id,
                    "title": session.title,
                    "invitedBy": owner_email,
                },
            )
            continue

        invite_row = (
            db.query(SessionInvite)
            .filter_by(session_id=session_id, email=invite_email)
            .first()
        )
        if invite_row is None:
            invite_row = SessionInvite(
                session_id=session_id,
                email=invite_email,
                role="participant",
                token=_uuid(),
            )
            db.add(invite_row)
        else:
            invite_row.role = "participant"
            if not invite_row.token:
                invite_row.token = _uuid()

        link = f"{origin}/?sid={session_id}&participant=1&token={invite_row.token}"
        results.append({
            "email": invite_email,
            "status": "invite-sent",
            "existingUser": False,
            "link": link,
        })

    return results


def _session_activity_timestamp(db, session_id: str):
    timestamps = [
        db.query(Session.created_at).filter_by(id=session_id).scalar(),
        db.query(func.max(Member.joined_at)).filter_by(session_id=session_id).scalar(),
        db.query(func.max(ListItem.created_at)).filter_by(session_id=session_id).scalar(),
        db.query(func.max(Score.created_at)).filter_by(session_id=session_id).scalar(),
    ]
    timestamps = [t for t in timestamps if t]
    return max(timestamps) if timestamps else None


def _recompute_session_status(db, session_id: str):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        return

    members = db.query(Member).filter_by(session_id=session_id).all()
    participant_uids = [m.uid for m in members if m.role in {"owner", "voter", "participant"}]
    if not participant_uids:
        target_status = "active"
    else:
        state_rows = db.query(OwnerListState).filter_by(session_id=session_id).all()
        state_map = {row.owner_uid: row for row in state_rows}
        all_submitted = all(state_map.get(uid) and state_map[uid].status == "submitted" for uid in participant_uids)

        if not all_submitted:
            target_status = "active"
        else:
            required_names = session.max_names or 10
            list_rows = db.query(ListItem).filter_by(session_id=session_id).all()
            names_by_owner = {}
            for row in list_rows:
                names_by_owner.setdefault(row.owner_uid, []).append(row.name)
            names_ready = all(len(names_by_owner.get(uid, [])) == required_names for uid in participant_uids)

            if not names_ready:
                target_status = "active"
            else:
                score_rows = db.query(Score).filter_by(session_id=session_id).all()
                score_map = {}
                for row in score_rows:
                    score_map.setdefault(row.rater_uid, {}).setdefault(row.list_owner_uid, set()).add(row.name)

                all_scored = True
                for rater in participant_uids:
                    for owner_uid in participant_uids:
                        if owner_uid == rater:
                            continue
                        expected_names = names_by_owner.get(owner_uid, [])
                        scored_names = score_map.get(rater, {}).get(owner_uid, set())
                        if len(scored_names) < len(expected_names):
                            all_scored = False
                            break
                    if not all_scored:
                        break

                target_status = "completed" if (all_scored and session.invites_locked) else "active"

    if session.status != target_status:
        session.status = target_status
        db.commit()


def _serialize_session_for_user(session: Session, *, role: str, owners: int, max_owners: int, activity_ts) -> dict:
    max_names = session.max_names or 10
    return {
        "sid": session.id,
        "title": session.title,
        "status": session.status,
        "owners": owners,
        "maxOwners": max_owners,
        "maxNames": max_names,
        "requiredNames": max_names,
        "nameFocus": session.name_focus or "mix",
        "invitesLocked": bool(session.invites_locked),
        "createdAt": _isoformat(session.created_at),
        "updatedAt": _isoformat(activity_ts or session.created_at),
        "role": role,
    }


def _serialize_session_doc(session: Session, members, *, include_tokens: bool):
    owner_ids = [m.uid for m in members if m.role == "owner"]
    participant_ids = [m.uid for m in members if m.role in {"participant", "voter"}]
    voter_ids = [m.uid for m in members if m.role in {"participant", "voter"}]
    max_names = session.max_names or 10
    data = {
        "sid": session.id,
        "title": session.title,
        "status": session.status,
        "maxOwners": 1,
        "maxNames": max_names,
        "requiredNames": max_names,
        "nameFocus": session.name_focus or "mix",
        "ownerIds": owner_ids,
        "voterIds": voter_ids,
        "participantIds": participant_ids,
        "createdAt": _isoformat(session.created_at),
        "createdBy": session.created_by,
        "invitesLocked": bool(session.invites_locked),
    }
    if include_tokens:
        data["inviteOwnerToken"] = session.invite_owner_token
        data["inviteVoterToken"] = session.invite_voter_token
    return data

# ----------------------------------------------------------------------------
# API Endpoints
# ----------------------------------------------------------------------------

# --- Signup endpoint (MySQL-backed) ---
@app.route("/api/signup", methods=["POST"])
def api_signup():
    db = SessionLocal()
    data = request.get_json(force=True) or {}
    full_name = (data.get("fullName") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not full_name or not email or not password:
        return jsonify({"ok": False, "error": "Missing fields"}), 400
    if not _is_valid_email(email):
        return jsonify({"ok": False, "error": "Invalid email address"}), 400
    if db.query(User).filter_by(email=email).first():
        return jsonify({"ok": False, "error": "Email already exists"}), 409

    hashed = generate_password_hash(password)
    user = User(email=email, display_name=full_name, password_hash=hashed)
    db.add(user)
    db.commit()
    return jsonify({"ok": True, "user": {"email": email, "displayName": full_name}})

# --- Login endpoint (MySQL-backed) ---
@app.route("/api/login", methods=["POST"])
def api_login():
    db = SessionLocal()
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    user = db.query(User).filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"ok": False, "error": "Invalid credentials"}), 401
    return jsonify({"ok": True, "user": {"email": email, "displayName": user.display_name}})


# --- Google OAuth login endpoint ---
@app.route("/api/google-login", methods=["POST"])
def api_google_login():
    db = SessionLocal()
    data = request.get_json(force=True) or {}
    token = (data.get("idToken") or "").strip()
    if not token:
        return jsonify({"ok": False, "error": "idToken required"}), 400

    if not GOOGLE_OAUTH_CLIENT_ID and not FIREBASE_PROJECT_ID:
        return jsonify({"ok": False, "error": "Google login not configured"}), 503

    verifier_errors = []
    request_adapter = google_requests.Request()
    id_info = None

    if FIREBASE_PROJECT_ID:
        try:
            candidate = google_id_token.verify_firebase_token(
                token,
                request_adapter,
                FIREBASE_PROJECT_ID,
            )
            issuer = candidate.get("iss")
            expected_issuer = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
            if issuer != expected_issuer:
                raise ValueError(f"Unexpected issuer: {issuer}")
            aud = candidate.get("aud")
            if aud != FIREBASE_PROJECT_ID:
                raise ValueError(f"Invalid audience: {aud}")
            id_info = candidate
        except ValueError as exc:
            verifier_errors.append(("firebase", str(exc)))

    if id_info is None and GOOGLE_OAUTH_CLIENT_ID:
        try:
            candidate = google_id_token.verify_oauth2_token(
                token,
                request_adapter,
                GOOGLE_OAUTH_CLIENT_ID,
            )
            issuer = candidate.get("iss")
            if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
                raise ValueError(f"Unexpected issuer: {issuer}")
            aud = candidate.get("aud")
            valid_audiences = {GOOGLE_OAUTH_CLIENT_ID}
            if isinstance(aud, str):
                aud_values = {aud}
            else:
                aud_values = set(aud or [])
            if not aud_values & valid_audiences:
                raise ValueError(f"Invalid audience: {aud}")
            id_info = candidate
        except ValueError as exc:
            verifier_errors.append(("oauth", str(exc)))

    if id_info is None:
        print("Google token verification failed", verifier_errors)
        return jsonify({"ok": False, "error": "Invalid Google token"}), 401

    email = (id_info.get("email") or "").lower()
    display_name = id_info.get("name") or id_info.get("email") or "Google user"
    photo_url = id_info.get("picture")
    email_verified = bool(id_info.get("email_verified", False))

    if not email:
        return jsonify({"ok": False, "error": "Google account missing email"}), 400

    created = False
    try:
        user = db.query(User).filter_by(email=email).first()
        if not user:
            placeholder_password = generate_password_hash(_uuid())
            user = User(email=email, display_name=display_name, password_hash=placeholder_password)
            db.add(user)
            created = True
        else:
            if display_name and user.display_name != display_name:
                user.display_name = display_name
        db.commit()
    except Exception as exc:
        db.rollback()
        print("Failed to persist Google user", exc)
        return jsonify({"ok": False, "error": "Unable to persist user"}), 500

    return jsonify({
        "ok": True,
        "user": {
            "email": user.email,
            "displayName": user.display_name or display_name or user.email,
            "uid": user.email,
            "photoURL": photo_url,
            "emailVerified": email_verified,
        "provider": "google",
        "created": created,
    },
    })


# --- Session APIs ---
def _ensure_member(db, session_id: str, uid: str):
    return db.query(Member).filter_by(session_id=session_id, uid=uid).first()


@app.route("/api/sessions", methods=["POST"])
def api_create_session():
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        title = (data.get("title") or "Untitled session").strip()[:200]
        required_names = data.get("requiredNames") or data.get("maxNames") or 10
        name_focus = (data.get("nameFocus") or "mix").strip().lower()
        invites_raw = data.get("invites") or []

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400
        try:
            required_names = int(required_names)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "requiredNames must be a number"}), 400

        if required_names < 4 or required_names > 100:
            return jsonify({"ok": False, "error": "requiredNames must be between 4 and 100"}), 400

        if name_focus == "mix" and required_names % 4 != 0:
            return jsonify({"ok": False, "error": "For mix sessions, required names must be a multiple of 4"}), 400

        if name_focus in {"girl", "boy"} and required_names % 4 not in {0, 2}:
            return jsonify({"ok": False, "error": "For single-gender sessions, required names must be an even number"}), 400

        if name_focus not in {"girl", "boy", "mix"}:
            name_focus = "mix"

        existing_title = (
            db.query(Session)
            .filter(func.lower(Session.title) == title.lower())
            .first()
        )
        if existing_title:
            return jsonify({"ok": False, "error": "Session name already in use"}), 409

        seen_invite_emails = set()
        cleaned_invites = []
        for raw in invites_raw:
            invite_email = None
            if isinstance(raw, dict):
                invite_email = _normalize_email(raw.get("email"))
            else:
                invite_email = _normalize_email(raw)
            if not invite_email or invite_email == email:
                continue
            if not _is_valid_email(invite_email):
                return jsonify({"ok": False, "error": f"Invalid invite email: {invite_email}"}), 400
            if invite_email in seen_invite_emails:
                return jsonify({"ok": False, "error": f"Duplicate invite: {invite_email}"}), 400
            seen_invite_emails.add(invite_email)
            role = _session_member_role(raw.get("role") if isinstance(raw, dict) else None)
            cleaned_invites.append({"email": invite_email, "role": role})

        sid = _uuid()
        owner_token = _uuid()
        voter_token = _uuid()

        session = Session(
            id=sid,
            title=title or "Untitled session",
            created_by=email,
            max_owners=1,
            max_names=required_names,
            name_focus=name_focus,
            status="active",
            invite_owner_token=owner_token,
            invite_voter_token=voter_token,
        )
        member = Member(session_id=sid, uid=email, role="owner")
        owner_state = OwnerListState(session_id=sid, owner_uid=email, status="draft")

        try:
            db.add(session)
            db.add(member)
            db.add(owner_state)
            db.flush()
            origin = _compute_invite_origin(request)
            invite_payload = _invite_participants(
                db,
                session=session,
                owner_email=email,
                invite_specs=cleaned_invites,
                origin=origin,
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to create session", exc)
            return jsonify({"ok": False, "error": "Unable to create session"}), 500

        activity_ts = _session_activity_timestamp(db, sid)
        payload = _serialize_session_for_user(
            session,
            role="owner",
            owners=1,
            max_owners=1,
            activity_ts=activity_ts,
        )
        payload.update({
            "inviteOwnerToken": owner_token,
            "inviteVoterToken": voter_token,
            "invites": invite_payload,
            "requiredNames": required_names,
            "nameFocus": name_focus,
            "ownerIds": [email],
            "voterIds": [],
            "createdBy": email,
            "viewerRole": "owner",
            "invitesLocked": False,
            "listStates": {
                email: {
                    "status": "draft",
                    "submittedAt": None,
                    "updatedAt": _isoformat(now_utc()),
                }
            },
        })
        return jsonify({"ok": True, "session": payload})
    finally:
        db.close()


@app.route("/api/sessions", methods=["GET"])
def api_list_sessions():
    email = _normalize_email(request.args.get("email"))
    if not email:
        return jsonify({"ok": False, "error": "email query param required"}), 400

    db = SessionLocal()
    try:
        memberships = (
            db.query(Session, Member)
            .join(Member, Member.session_id == Session.id)
            .filter(Member.uid == email)
            .order_by(Session.created_at.desc())
            .all()
        )
        session_ids = [s.id for s, _ in memberships]
        if not session_ids:
            return jsonify({"ok": True, "active": [], "archived": []})

        owner_counts = {
            sid: count
            for sid, count in db.query(Member.session_id, func.count())
            .filter(Member.session_id.in_(session_ids), Member.role == "owner")
            .group_by(Member.session_id)
        }

        state_rows = (
            db.query(OwnerListState)
            .filter(OwnerListState.session_id.in_(session_ids))
            .all()
        )
        state_map = {}
        for state in state_rows:
            state_map.setdefault(state.session_id, {})[state.owner_uid] = state

        active, archived = [], []
        for session, member in memberships:
            activity_ts = _session_activity_timestamp(db, session.id)
            record = _serialize_session_for_user(
                session,
                role=member.role,
                owners=owner_counts.get(session.id, 0),
                max_owners=1,
                activity_ts=activity_ts,
            )
            state = state_map.get(session.id, {}).get(member.uid)
            if state:
                record["listStatus"] = state.status
                record["listSubmittedAt"] = _isoformat(state.submitted_at)
            else:
                record["listStatus"] = "draft"
                record["listSubmittedAt"] = None
            record["maxNames"] = session.max_names or 10
            record["requiredNames"] = session.max_names or 10
            record["nameFocus"] = session.name_focus or "mix"
            record["invitesLocked"] = bool(session.invites_locked)
            if member.role == "owner":
                record["inviteOwnerToken"] = session.invite_owner_token
                record["inviteVoterToken"] = session.invite_voter_token
            (archived if session.status == "archived" else active).append(record)

        return jsonify({"ok": True, "active": active, "archived": archived})
    finally:
        db.close()


@app.route("/api/sessions/<sid>", methods=["GET"])
def api_get_session(sid):
    email = _normalize_email(request.args.get("email"))
    if not sid:
        return jsonify({"ok": False, "error": "Session id required"}), 400

    db = SessionLocal()
    try:
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, email) if email else None
        if email and not member:
            return jsonify({"ok": False, "error": "Not a participant"}), 403

        members = db.query(Member).filter_by(session_id=sid).all()
        include_tokens = bool(member and member.role == "owner")
        session_doc = _serialize_session_doc(session, members, include_tokens=include_tokens)

        state_rows = db.query(OwnerListState).filter_by(session_id=sid).all()
        state_map = {
            state.owner_uid: {
                "status": state.status,
                "submittedAt": _isoformat(state.submitted_at),
                "updatedAt": _isoformat(state.updated_at),
            }
            for state in state_rows
        }
        session_doc["listStates"] = state_map
        session_doc["viewerRole"] = member.role if member else None
        session_doc["invitesLocked"] = bool(session.invites_locked)

        list_rows = (
            db.query(ListItem)
            .filter_by(session_id=sid)
            .order_by(ListItem.owner_uid, ListItem.self_rank)
            .all()
        )
        lists = {}
        for row in list_rows:
            entry = lists.setdefault(row.owner_uid, {"names": [], "selfRanks": {}, "status": state_map.get(row.owner_uid, {}).get("status", "draft")})
            entry["names"].append(row.name)
            entry["selfRanks"][row.name] = row.self_rank

        # ensure every owner appears in lists even if empty
        for owner_uid, state in state_map.items():
            lists.setdefault(owner_uid, {"names": [], "selfRanks": {}, "status": state.get("status", "draft")})

        viewer_uid = email
        filtered_lists = {}
        for owner_uid, data in lists.items():
            status = data.get("status", "draft")
            if owner_uid != viewer_uid and status != "submitted":
                continue
            filtered_lists[owner_uid] = data

        scores_rows = db.query(Score).filter_by(session_id=sid).all()
        scores = [
            {
                "listOwnerUid": row.list_owner_uid,
                "raterUid": row.rater_uid,
                "name": row.name,
                "scoreValue": row.score_value,
                "createdAt": _isoformat(row.created_at),
            }
            for row in scores_rows
        ]

        if session.status != "completed":
            viewer_uid = member.uid if member else None
            if viewer_uid:
                scores = [score for score in scores if score["raterUid"] == viewer_uid]
            else:
                scores = []

        viewer_uid = member.uid if member else None
        message_rows = []
        if viewer_uid:
            message_rows = (
                db.query(Message)
                .filter_by(session_id=sid)
                .order_by(Message.created_at.desc())
                .limit(200)
                .all()
            )

        def _message_visible(row: Message) -> bool:
            if row.recipient_uid is None:
                return True
            return row.recipient_uid == viewer_uid or row.sender_uid == viewer_uid

        messages = [
            _serialize_message(row)
            for row in reversed(message_rows)
            if _message_visible(row)
        ]

        return jsonify({
            "ok": True,
            "session": session_doc,
            "lists": filtered_lists,
            "scores": scores,
            "viewerRole": session_doc.get("viewerRole"),
            "messages": messages,
        })
    finally:
        db.close()


@app.route("/api/sessions/join", methods=["POST"])
def api_join_session():
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        token = (data.get("token") or "").strip()

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400
        if not token:
            return jsonify({"ok": False, "error": "Invite token required"}), 400

        invite_query = db.query(SessionInvite).filter(SessionInvite.token == token)
        request_sid = data.get("sid")
        if request_sid:
            invite_query = invite_query.filter(SessionInvite.session_id == request_sid)
        invite = invite_query.first()
        if not invite:
            return jsonify({"ok": False, "error": "Invalid or expired invite"}), 404

        session = db.query(Session).filter_by(id=invite.session_id).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        sid = session.id

        if session.status == "archived":
            return jsonify({"ok": False, "error": "Session is archived"}), 409

        target_email = _normalize_email(invite.email)
        if target_email and target_email != email:
            return jsonify({"ok": False, "error": "Invite email mismatch"}), 403

        existing = _ensure_member(db, sid, email)
        if session.invites_locked and not existing:
            return jsonify({"ok": False, "error": "Invites are locked for this session"}), 409

        if existing:
            _ensure_owner_list_state(db, sid, email)
            db.query(SessionInvite).filter_by(session_id=sid, email=email).delete()
            db.commit()
            return jsonify({"ok": True, "role": existing.role, "sid": sid})

        try:
            db.add(Member(session_id=sid, uid=email, role="participant"))
            db.flush()
            _ensure_owner_list_state(db, sid, email)
            db.query(SessionInvite).filter_by(session_id=sid, email=email).delete()
            _create_notification(
                db,
                user_email=session.created_by,
                session_id=sid,
                type_="participant_joined",
                payload={"sid": sid, "email": email},
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to join session", exc)
            return jsonify({"ok": False, "error": "Unable to join session"}), 500

        return jsonify({"ok": True, "role": "participant", "sid": sid})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/participants", methods=["POST"])
def api_add_participants(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        owner_email = _normalize_email(data.get("email"))
        participants = data.get("participants") or data.get("invites") or []

        if not owner_email or not _is_valid_email(owner_email):
            return jsonify({"ok": False, "error": "Valid owner email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if session.created_by != owner_email:
            return jsonify({"ok": False, "error": "Only the session owner can invite participants"}), 403
        if session.status == "archived":
            return jsonify({"ok": False, "error": "Session archived"}), 409

        cleaned_specs = []
        seen = set()
        for item in participants:
            invite_email = None
            role = None
            if isinstance(item, dict):
                invite_email = _normalize_email(item.get("email"))
                role = item.get("role")
            else:
                invite_email = _normalize_email(item)
            if not invite_email or invite_email == owner_email:
                continue
            if not _is_valid_email(invite_email):
                return jsonify({"ok": False, "error": f"Invalid invite email: {invite_email}"}), 400
            if invite_email in seen:
                return jsonify({"ok": False, "error": f"Duplicate invite: {invite_email}"}), 400
            seen.add(invite_email)
            cleaned_specs.append({"email": invite_email, "role": role})

        origin = _compute_invite_origin(request)
        try:
            results = _invite_participants(
                db,
                session=session,
                owner_email=owner_email,
                invite_specs=cleaned_specs,
                origin=origin,
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to invite participants", exc)
            return jsonify({"ok": False, "error": "Unable to invite participants"}), 500

        return jsonify({"ok": True, "results": results})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/participants", methods=["DELETE"])
def api_remove_participant(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        owner_email = _normalize_email(data.get("email"))
        target_email = _normalize_email(data.get("participantEmail"))

        if not owner_email or not _is_valid_email(owner_email):
            return jsonify({"ok": False, "error": "Valid owner email required"}), 400
        if not target_email or not _is_valid_email(target_email):
            return jsonify({"ok": False, "error": "Valid participant email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if session.created_by != owner_email:
            return jsonify({"ok": False, "error": "Only the session owner can remove participants"}), 403
        if target_email == session.created_by:
            return jsonify({"ok": False, "error": "Cannot remove the session owner"}), 400

        membership = _ensure_member(db, sid, target_email)
        if not membership:
            db.query(SessionInvite).filter_by(session_id=sid, email=target_email).delete()
            db.commit()
            return jsonify({"ok": True, "removed": False})

        try:
            db.query(Score).filter(
                (Score.session_id == sid)
                & ((Score.list_owner_uid == target_email) | (Score.rater_uid == target_email))
            ).delete()
            db.query(ListItem).filter_by(session_id=sid, owner_uid=target_email).delete()
            db.query(OwnerListState).filter_by(session_id=sid, owner_uid=target_email).delete()
            db.query(SessionInvite).filter_by(session_id=sid, email=target_email).delete()
            db.query(Member).filter_by(session_id=sid, uid=target_email).delete()
            _create_notification(
                db,
                user_email=target_email,
                session_id=sid,
                type_="removed_from_session",
                payload={"sid": sid, "title": session.title},
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to remove participant", exc)
            return jsonify({"ok": False, "error": "Unable to remove participant"}), 500

        _recompute_session_status(db, sid)
        return jsonify({"ok": True, "removed": True})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/lock-invites", methods=["POST"])
def api_lock_invites(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if session.created_by != email:
            return jsonify({"ok": False, "error": "Only the host can lock invites"}), 403
        if session.invites_locked:
            return jsonify({"ok": True, "invitesLocked": True})

        session.invites_locked = True
        for member in db.query(Member).filter_by(session_id=sid).all():
            if member.uid == email:
                continue
            _create_notification(
                db,
                user_email=member.uid,
                session_id=sid,
                type_="invites_locked",
                payload={"sid": sid, "title": session.title},
            )
        db.commit()
        _recompute_session_status(db, sid)
        return jsonify({"ok": True, "invitesLocked": True})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/lists", methods=["POST"])
def api_upsert_list(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        names = data.get("names") or []
        self_ranks = data.get("selfRanks") or {}
        finalize = bool(data.get("finalize"))

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if session.status == "archived":
            return jsonify({"ok": False, "error": "Session archived"}), 409
        if session.status == "completed":
            return jsonify({"ok": False, "error": "Session completed; lists are locked"}), 409

        max_names = session.max_names or 10

        member = _ensure_member(db, sid, email)
        editable_roles = {"owner", "voter", "participant"}
        if not member or member.role not in editable_roles:
            return jsonify({"ok": False, "error": "Only session participants can save lists"}), 403

        _ensure_owner_list_state(db, sid, email)

        cleaned = []
        seen_names = set()
        for idx, name in enumerate(names):
            trimmed = (name or "").strip()
            if not trimmed:
                continue
            lowered = trimmed.lower()
            if lowered in seen_names:
                return jsonify({"ok": False, "error": "Names must be unique"}), 400
            seen_names.add(lowered)
            rank_value = self_ranks.get(name)
            if rank_value is None:
                rank_value = self_ranks.get(trimmed)
            if rank_value is None:
                rank_value = idx + 1
            try:
                rank = int(rank_value)
            except (TypeError, ValueError):
                rank = idx + 1
            if rank < 1 or rank > max_names:
                if finalize:
                    return jsonify({"ok": False, "error": f"Ranks must be 1-{max_names}"}), 400
            cleaned.append((trimmed, rank))

        if finalize:
            if len(cleaned) != max_names:
                return jsonify({"ok": False, "error": f"Exactly {max_names} names required"}), 400
            rank_set = {rank for _, rank in cleaned}
            if len(rank_set) != max_names or rank_set != set(range(1, max_names + 1)):
                return jsonify({"ok": False, "error": f"Ranks must cover 1-{max_names} with no duplicates"}), 400
        else:
            cleaned = [
                (name, max(0, min(rank, max_names)))
                for name, rank in cleaned
            ]

        state = db.query(OwnerListState).filter_by(session_id=sid, owner_uid=email).first()
        if not state:
            state = OwnerListState(session_id=sid, owner_uid=email, status="draft")
            db.add(state)
        if state.status == "submitted" and not finalize:
            return jsonify({"ok": False, "error": "List already submitted"}), 409
        if state.status == "submitted" and finalize:
            return jsonify({"ok": False, "error": "List already submitted"}), 409

        notify_targets = []
        if finalize:
            notify_targets = [
                member.uid
                for member in db.query(Member).filter_by(session_id=sid).all()
                if member.uid != email
            ]

        try:
            db.query(ListItem).filter_by(session_id=sid, owner_uid=email).delete()
            for name, rank in cleaned:
                db.add(ListItem(session_id=sid, owner_uid=email, name=name, self_rank=rank))
            state.status = "submitted" if finalize else "draft"
            state.updated_at = now_utc()
            state.submitted_at = now_utc() if finalize else None
            for target in notify_targets:
                _create_notification(
                    db,
                    user_email=target,
                    session_id=sid,
                    type_="list_submitted",
                    payload={"sid": sid, "by": email},
                )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to upsert list", exc)
            return jsonify({"ok": False, "error": "Unable to save list"}), 500

        _recompute_session_status(db, sid)

        return jsonify({"ok": True, "status": state.status})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/scores", methods=["POST"])
def api_submit_score(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        list_owner_uid = _normalize_email(data.get("listOwnerUid"))
        name = (data.get("name") or "").strip()
        score_value = data.get("scoreValue")

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400
        if not list_owner_uid or not name:
            return jsonify({"ok": False, "error": "Owner and name required"}), 400
        try:
            score_value = int(score_value)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Score must be an integer"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        max_names = session.max_names or 10
        if score_value < 1 or score_value > max_names:
            return jsonify({"ok": False, "error": f"Score must be 1-{max_names}"}), 400
        if session.status == "archived":
            return jsonify({"ok": False, "error": "Session archived"}), 409
        if session.status == "completed":
            return jsonify({"ok": False, "error": "Session completed; voting is closed"}), 409

        owner_state = db.query(OwnerListState).filter_by(session_id=sid, owner_uid=list_owner_uid).first()
        if not owner_state or owner_state.status != "submitted":
            return jsonify({"ok": False, "error": "Owner list not submitted"}), 409

        member = _ensure_member(db, sid, email)
        if not member:
            return jsonify({"ok": False, "error": "Not a participant"}), 403
        if email == list_owner_uid:
            return jsonify({"ok": False, "error": "Cannot score own list"}), 400

        rater_state = db.query(OwnerListState).filter_by(session_id=sid, owner_uid=email).first()
        if not rater_state or rater_state.status != "submitted":
            return jsonify({"ok": False, "error": "Submit your list before scoring others"}), 409

        list_names = {
            row.name
            for row in db.query(ListItem).filter_by(session_id=sid, owner_uid=list_owner_uid).all()
        }
        if name not in list_names:
            return jsonify({"ok": False, "error": "Name not part of list"}), 400

        existing_scores = db.query(Score).filter_by(
            session_id=sid,
            list_owner_uid=list_owner_uid,
            rater_uid=email,
        ).all()

        for existing_score in existing_scores:
            if existing_score.score_value == score_value and existing_score.name != name:
                return jsonify({"ok": False, "error": "Each rank can be used only once per list"}), 400

        try:
            existing = next((row for row in existing_scores if row.name == name), None)
            if existing:
                existing.score_value = score_value
                existing.created_at = now_utc()
            else:
                db.add(Score(
                    session_id=sid,
                    list_owner_uid=list_owner_uid,
                    rater_uid=email,
                    name=name,
                    score_value=score_value,
                ))
            db.flush()

            assigned_scores = db.query(Score).filter_by(
                session_id=sid,
                list_owner_uid=list_owner_uid,
                rater_uid=email,
            ).all()
            completed = len(list_names) > 0 and len(assigned_scores) == len(list_names)
            if completed:
                _create_notification(
                    db,
                    user_email=list_owner_uid,
                    session_id=sid,
                    type_="list_scored",
                    payload={"sid": sid, "by": email},
                )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to submit score", exc)
            return jsonify({"ok": False, "error": "Unable to submit score"}), 500

        _recompute_session_status(db, sid)

        return jsonify({"ok": True})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/messages", methods=["GET"])
def api_list_messages(sid):
    email = _normalize_email(request.args.get("email"))
    if not email:
        return jsonify({"ok": False, "error": "Email required"}), 400

    db = SessionLocal()
    try:
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, email)
        if not member:
            return jsonify({"ok": False, "error": "Not a participant"}), 403

        message_rows = (
            db.query(Message)
            .filter_by(session_id=sid)
            .order_by(Message.created_at.desc())
            .limit(200)
            .all()
        )

        def _can_view(message: Message) -> bool:
            if message.recipient_uid is None:
                return True
            return message.recipient_uid == email or message.sender_uid == email

        payload = [
            _serialize_message(row)
            for row in reversed(message_rows)
            if _can_view(row)
        ]
        return jsonify({"ok": True, "messages": payload})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/messages", methods=["POST"])
def api_send_message(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        sender = _normalize_email(data.get("email"))
        recipient = data.get("recipient")
        if isinstance(recipient, str):
            recipient = _normalize_email(recipient)
        else:
            recipient = None
        kind = (data.get("kind") or "message").strip().lower()
        body = (data.get("body") or "").strip()

        if not sender or not _is_valid_email(sender):
            return jsonify({"ok": False, "error": "Valid sender email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, sender)
        if not member:
            return jsonify({"ok": False, "error": "Not a participant"}), 403

        if kind == "nudge":
            if not recipient:
                return jsonify({"ok": False, "error": "Nudges require a recipient"}), 400
            if recipient == sender:
                return jsonify({"ok": False, "error": "Cannot nudge yourself"}), 400
            if not body:
                body = "Please submit your list when you have a moment!"
        else:
            if not body:
                return jsonify({"ok": False, "error": "Message body required"}), 400

        if len(body) > 500:
            return jsonify({"ok": False, "error": "Message too long"}), 400

        if recipient and not _ensure_member(db, sid, recipient):
            return jsonify({"ok": False, "error": "Recipient is not part of this session"}), 403

        message = Message(
            session_id=sid,
            sender_uid=sender,
            recipient_uid=recipient if recipient else None,
            body=body,
            kind=kind,
        )

        notify_targets = []
        if recipient:
            notify_targets = [recipient]
        else:
            notify_targets = [
                row.uid
                for row in db.query(Member).filter_by(session_id=sid).all()
                if row.uid != sender
            ]

        try:
            db.add(message)
            for target in notify_targets:
                _create_notification(
                    db,
                    user_email=target,
                    session_id=sid,
                    type_="nudge" if kind == "nudge" else "message",
                    payload={
                        "sid": sid,
                        "from": sender,
                        "kind": kind,
                        "recipient": recipient,
                        "direct": bool(recipient),
                    },
                )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to send message", exc)
            return jsonify({"ok": False, "error": "Unable to send message"}), 500

        return jsonify({"ok": True, "message": _serialize_message(message)})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/archive", methods=["POST"])
def api_archive_session(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, email)
        if not member or member.role != "owner":
            return jsonify({"ok": False, "error": "Only owners can archive"}), 403

        session.status = "archived"
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to archive session", exc)
            return jsonify({"ok": False, "error": "Unable to archive session"}), 500

        return jsonify({"ok": True})
    finally:
        db.close()


@app.route("/api/sessions/<sid>", methods=["DELETE"])
def api_delete_session(sid):
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, email)
        if not member or member.role != "owner":
            return jsonify({"ok": False, "error": "Only owners can delete"}), 403

        try:
            db.delete(session)
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to delete session", exc)
            return jsonify({"ok": False, "error": "Unable to delete session"}), 500

        return jsonify({"ok": True})
    finally:
        db.close()

# --- Password reset request endpoint ---
@app.route("/api/reset-password-request", methods=["POST"])
def api_reset_password_request():
    db = SessionLocal()
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"ok": False, "error": "Email required"}), 400
    if not _is_valid_email(email):
        return jsonify({"ok": False, "error": "Invalid email address"}), 400

    user = db.query(User).filter_by(email=email).first()
    if not user:
        # Don't reveal if email exists
        return jsonify({"ok": True, "message": "If the email exists, a reset link has been sent."}), 200

    token = _uuid()  # Use existing _uuid function
    expires_at = now_utc() + timedelta(hours=1)
    reset = ResetToken(user_id=user.id, token=token, expires_at=expires_at)
    db.add(reset)
    db.commit()

    # TODO: Send email with link like https://yourdomain.com/reset?token=token
    # For now, return token for testing
    return jsonify({"ok": True, "token": token, "message": "Reset token generated (for dev)."}), 200

# --- Password reset confirmation endpoint ---
@app.route("/api/reset-password", methods=["POST"])
def api_reset_password():
    db = SessionLocal()
    data = request.get_json(force=True) or {}
    token = (data.get("token") or "").strip()
    new_password = data.get("newPassword") or ""

    if not token or not new_password:
        return jsonify({"ok": False, "error": "Token and new password required"}), 400

    reset = db.query(ResetToken).filter_by(token=token).first()
    if not reset or reset.expires_at < now_utc():
        return jsonify({"ok": False, "error": "Invalid or expired token"}), 401

    user = reset.user
    hashed = generate_password_hash(new_password)
    user.password_hash = hashed
    db.delete(reset)  # One-time use
    db.commit()
    return jsonify({"ok": True, "message": "Password reset successfully."}), 200


@app.route("/api/notifications", methods=["GET"])
def api_notifications():
    email = _normalize_email(request.args.get("email"))
    if not email:
        return jsonify({"ok": False, "error": "email query param required"}), 400

    db = SessionLocal()
    try:
        rows = (
            db.query(Notification)
            .filter(
                Notification.user_email == email,
                Notification.read_at.is_(None),
            )
            .order_by(Notification.created_at.desc())
            .limit(100)
            .all()
        )
        return jsonify({
            "ok": True,
            "notifications": [_serialize_notification(row) for row in rows],
        })
    finally:
        db.close()


@app.route("/api/notifications/mark-read", methods=["POST"])
def api_notifications_mark_read():
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = _normalize_email(data.get("email"))
        ids = data.get("ids") or []

        if not email:
            return jsonify({"ok": False, "error": "Email required"}), 400
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            return jsonify({"ok": False, "error": "ids must be an array of integers"}), 400

        try:
            (
                db.query(Notification)
                .filter(Notification.user_email == email, Notification.id.in_(ids))
                .delete(synchronize_session=False)
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to mark notifications", exc)
            return jsonify({"ok": False, "error": "Unable to update notifications"}), 500

        return jsonify({"ok": True})
    finally:
        db.close()

# ----------------------------------------------------------------------------
# Static hosting (built app in /dist)
# ----------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    # Only handle non-API routes
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    if os.path.isdir(DIST_DIR):
        full = os.path.join(DIST_DIR, path)
        if os.path.exists(full) and not os.path.isdir(full):
            return send_from_directory(DIST_DIR, os.path.relpath(full, DIST_DIR))
        # Let the SPA handle unknown client routes
        index_path = os.path.join(DIST_DIR, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(DIST_DIR, "index.html")
    return "Build not found. Run Vite build to populate /dist.", 200

# ----------------------------------------------------------------------------
# WSGI (PythonAnywhere) and local runner
# ----------------------------------------------------------------------------

# For PythonAnywhere WSGI
application = app

if __name__ == "__main__":
    # Load .env.local automatically if present (development)
    try:
        from dotenv import load_dotenv
        load_dotenv(".env.local", override=True)
    except Exception:
        pass
    print("DEBUG: entering __main__ block")
    Base.metadata.create_all(engine)
    app.run(debug=True, host="127.0.0.1", port=5050)
