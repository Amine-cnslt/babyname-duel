from __future__ import annotations

from werkzeug.security import generate_password_hash, check_password_hash

"""
Flask server for BabyNames Hive (MySQL path)
- Serves the built SPA from /dist (when present)
- Provides REST API for sessions, members, lists, scores, tiebreaks
- Config via environment variables (export from .env.local before running)

Required env:
  DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME
Optional:
  ALLOWED_ORIGIN=http://localhost:5173  (CORS for /api/*)
"""

import base64
import json
import os
import re
import secrets
import smtplib
import ssl
import time
import logging
import hashlib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Optional
from uuid import uuid4

from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Text,
    ForeignKey, UniqueConstraint, text as sql_text, func, inspect, Boolean
)
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session, relationship
from sqlalchemy.exc import OperationalError
from dotenv import load_dotenv
import certifi
try:
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Mail, Content
except ImportError:  # pragma: no cover - optional dependency
    SendGridAPIClient = None
    Mail = None
    Content = None
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
import requests as http_requests
from urllib.parse import urlencode, urlparse, parse_qsl, urlunparse

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

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "alloy")
OPENAI_TTS_FORMAT = os.getenv("OPENAI_TTS_FORMAT", "mp3")

# Email (password reset) configuration
EMAIL_SENDER = os.getenv("EMAIL_SENDER")
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}
SMTP_DEBUG = os.getenv("SMTP_DEBUG", "false").lower() in {"1", "true", "yes"}
PASSWORD_RESET_URL_BASE = os.getenv("PASSWORD_RESET_URL_BASE")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")

SESSION_TOKEN_TTL_HOURS = int(os.getenv("SESSION_TOKEN_TTL_HOURS", "24"))
MAX_SESSION_TOKENS_PER_USER = int(os.getenv("MAX_SESSION_TOKENS_PER_USER", "10"))


class AuthError(Exception):
    """Raised when authentication fails or credentials are missing."""

# ----------------------------------------------------------------------------
# App & Config
# ----------------------------------------------------------------------------

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
app = Flask(__name__, static_folder="dist", static_url_path="/")
app.logger.setLevel(logging.INFO)


@app.errorhandler(AuthError)
def _auth_error_handler(exc: AuthError):
    message = str(exc) if str(exc) else "Authentication required"
    return jsonify({"ok": False, "error": message}), 401


@app.route("/api/test", methods=["GET"])
def test_api():
    return {"message": "Flask backend is working!"}, 200


@app.route("/api/invite-info", methods=["GET"])
def api_invite_info():
    token = (request.args.get("token") or "").strip()
    sid = (request.args.get("sid") or "").strip()
    if not token:
        return jsonify({"ok": False, "error": "token query param required"}), 400

    db = SessionLocal()
    try:
        invite_query = db.query(SessionInvite).filter(SessionInvite.token == token)
        if sid:
            invite_query = invite_query.filter(SessionInvite.session_id == sid)
        invite = invite_query.first()
        if not invite:
            return jsonify({"ok": False, "error": "Invite not found"}), 404

        session = db.query(Session).filter_by(id=invite.session_id).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        payload = {
            "sid": session.id,
            "token": invite.token,
            "email": invite.email,
            "title": session.title,
            "requiredNames": session.max_names or 10,
            "nameFocus": session.name_focus or "mix",
            "createdBy": session.created_by,
            "invitesLocked": bool(session.invites_locked),
            "templateReady": bool(session.template_ready),
        }
        return jsonify({"ok": True, "invite": payload})
    finally:
        db.close()

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


def ensure_schema(retries: int = 5, delay: float = 2.0):
    attempt = 0
    while True:
        try:
            inspector = inspect(engine)
            if not inspector.has_table('sessions'):
                Base.metadata.create_all(bind=engine)
                return
            with engine.begin() as conn:
                session_cols = {col['name'] for col in inspector.get_columns('sessions')}
                if 'max_names' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN max_names INTEGER DEFAULT 10'))
                if 'invites_locked' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN invites_locked INTEGER DEFAULT 0'))
                if 'template_ready' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN template_ready INTEGER DEFAULT 0'))
                if 'name_focus' not in session_cols:
                    conn.execute(sql_text("ALTER TABLE sessions ADD COLUMN name_focus VARCHAR(16) DEFAULT 'mix'"))
                conn.execute(sql_text('UPDATE sessions SET max_names = 10 WHERE max_names IS NULL OR max_names < 5'))
                conn.execute(sql_text('UPDATE sessions SET invites_locked = 0 WHERE invites_locked IS NULL'))
                conn.execute(sql_text('UPDATE sessions SET template_ready = 0 WHERE template_ready IS NULL'))
                conn.execute(sql_text("UPDATE sessions SET name_focus = 'mix' WHERE name_focus IS NULL OR name_focus = ''"))
                if 'tiebreak_active' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN tiebreak_active INTEGER DEFAULT 0'))
                if 'tiebreak_names' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN tiebreak_names TEXT'))
                if 'final_winners' not in session_cols:
                    conn.execute(sql_text('ALTER TABLE sessions ADD COLUMN final_winners TEXT'))

                if not inspector.has_table('owner_list_states'):
                    OwnerListState.__table__.create(bind=engine, checkfirst=True)
                else:
                    owner_state_cols = {col['name'] for col in inspector.get_columns('owner_list_states')}
                    if 'slot_count' not in owner_state_cols:
                        conn.execute(sql_text('ALTER TABLE owner_list_states ADD COLUMN slot_count INTEGER DEFAULT 0'))
                if not inspector.has_table('messages'):
                    Message.__table__.create(bind=engine, checkfirst=True)
                if not inspector.has_table('notifications'):
                    Notification.__table__.create(bind=engine, checkfirst=True)
                if not inspector.has_table('name_metadata'):
                    NameMetadata.__table__.create(bind=engine, checkfirst=True)
                else:
                    meta_cols = {col['name'] for col in inspector.get_columns('name_metadata')}
                    if 'phonetic' not in meta_cols:
                        conn.execute(sql_text('ALTER TABLE name_metadata ADD COLUMN phonetic VARCHAR(120)'))
                    if 'audio_base64' not in meta_cols:
                        conn.execute(sql_text('ALTER TABLE name_metadata ADD COLUMN audio_base64 TEXT'))
                    if 'audio_mime' not in meta_cols:
                        conn.execute(sql_text('ALTER TABLE name_metadata ADD COLUMN audio_mime VARCHAR(64)'))
                if not inspector.has_table('activity_logs'):
                    ActivityLog.__table__.create(bind=engine, checkfirst=True)
                if not inspector.has_table('session_tokens'):
                    SessionToken.__table__.create(bind=engine, checkfirst=True)
                if not inspector.has_table('tie_break_votes'):
                    TieBreakVote.__table__.create(bind=engine, checkfirst=True)
            return
        except OperationalError as exc:
            attempt += 1
            if attempt > retries:
                raise
            sleep_for = delay * attempt
            print(f"ensure_schema retry {attempt}/{retries} after OperationalError: {exc}. Sleeping {sleep_for}s")
            time.sleep(sleep_for)


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


def _load_json_array(value):
    if not value:
        return []
    try:
        data = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _extract_auth_token() -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if isinstance(auth_header, str):
        scheme, _, candidate = auth_header.strip().partition(" ")
        if scheme.lower() == "bearer" and candidate:
            return candidate.strip()
    cookie_token = request.cookies.get("bnd_session")
    if cookie_token:
        return cookie_token
    return None


def _prune_session_tokens(db, user_id: int):
    if MAX_SESSION_TOKENS_PER_USER <= 0:
        return
    tokens = (
        db.query(SessionToken)
        .filter(SessionToken.user_id == user_id)
        .order_by(SessionToken.created_at.desc())
        .all()
    )
    if len(tokens) <= MAX_SESSION_TOKENS_PER_USER:
        return
    for stale in tokens[MAX_SESSION_TOKENS_PER_USER:]:
        db.delete(stale)


def _issue_session_token(db, user: User, *, ttl_hours: int = SESSION_TOKEN_TTL_HOURS) -> str:
    ttl = max(ttl_hours, 1)
    raw_token = secrets.token_hex(32)
    token_hash = _hash_token(raw_token)
    now = now_utc()
    session_token = SessionToken(
        user=user,
        token_hash=token_hash,
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(hours=ttl),
    )
    db.add(session_token)
    _prune_session_tokens(db, user.id)
    return raw_token


def _require_user(db) -> User:
    token = _extract_auth_token()
    if not token:
        raise AuthError("Authentication required")
    record = (
        db.query(SessionToken)
        .join(User)
        .filter(SessionToken.token_hash == _hash_token(token))
        .first()
    )
    if not record:
        raise AuthError("Invalid or expired session")
    if record.expires_at < now_utc():
        db.delete(record)
        raise AuthError("Session expired")
    record.last_used_at = now_utc()
    g.current_session_token = record
    g.current_user = record.user
    return record.user


def _revoke_current_token(db):
    session_token = getattr(g, "current_session_token", None)
    if session_token is not None:
        db.delete(session_token)


def _user_payload(user: User) -> dict:
    return {
        "email": user.email,
        "displayName": user.display_name,
    }


def _log_activity(db, *, actor: Optional[str], action: str, session_id: Optional[str] = None, details: Optional[dict] = None):
    if not action:
        return
    details_str = None
    if details is not None:
        if isinstance(details, (str, bytes)):
            details_str = details if isinstance(details, str) else details.decode("utf-8", "ignore")
        else:
            try:
                details_str = json.dumps(details, default=str)
            except Exception as exc:
                app.logger.warning("Unable to serialize activity details for %s: %s", action, exc)
                details_str = json.dumps({"__repr__": repr(details)})
    try:
        entry = ActivityLog(
            actor_email=actor,
            action=action,
            session_id=session_id,
            details=details_str,
        )
        db.add(entry)
    except Exception as exc:
        app.logger.warning("Failed to record activity %s: %s", action, exc)


def _first_name_from_email(value: str) -> str:
    if not value:
        return "friend"
    name = value.split("@")[0]
    name = re.sub(r"[._+\-]+", " ", name).strip()
    return name.title() if name else "friend"


def _render_reset_email_html(*, first_name: str, reset_link: Optional[str]) -> str:
    if reset_link:
        button_html = f"""
        <p style=\"text-align:center;margin:24px 0 16px;\">
          <a style=\"display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(135deg,#38bdf8,#f472b6);color:#ffffff;text-decoration:none;font-weight:600;letter-spacing:0.3px;box-shadow:0 12px 24px rgba(244,114,182,0.22);\"
             href=\"{reset_link}\" target=\"_blank\" rel=\"noopener\">
            Reset Password
          </a>
        </p>
        """
    else:
        button_html = """
        <p style=\"margin:20px 0;\">If the button is missing, open the app and request another reset link or contact support for help.</p>
        """



def _ensure_reset_link(token: str) -> Optional[str]:
    if not PASSWORD_RESET_URL_BASE:
        return None
    base = PASSWORD_RESET_URL_BASE
    if "{token}" in base:
        link = base.replace("{token}", token)
    elif base.endswith("?") or base.endswith("&"):
        link = f"{base}token={token}"
    elif base.endswith("="):
        link = f"{base}{token}"
    elif "?" in base:
        link = f"{base}&token={token}"
    elif base.endswith(("/", "#")):
        link = f"{base}{token}"
    else:
        link = f"{base}?token={token}"
    return _append_reset_params(link, token)


def _append_reset_params(link: str, token: str) -> str:
    parsed = urlparse(link)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if not query.get("token"):
        query["token"] = token
    if "mode" not in query:
        query["mode"] = "reset"
    new_query = urlencode(query)
    return urlunparse(parsed._replace(query=new_query))
    return f"""
    <!DOCTYPE html>
    <html lang=\"en\">
    <head>
      <meta charset=\"UTF-8\" />
      <title>Reset your BabyNames Hive password</title>
    </head>
    <body style=\"margin:0;padding:0;background:#f5f7ff;font-family:'Poppins','Segoe UI',sans-serif;color:#374151;\">
      <div style=\"max-width:520px;margin:32px auto;background:linear-gradient(135deg,#f9e0ff,#e0f3ff);border-radius:24px;padding:32px;border:1px solid rgba(147,197,253,0.35);box-shadow:0 18px 35px rgba(151,149,240,0.18);\">
        <div style=\"text-align:center;margin-bottom:20px;\">
          <h1 style=\"margin:0;font-size:28px;color:#1d4ed8;letter-spacing:0.5px;\">BabyNames Hive</h1>
          <p style=\"margin:6px 0 0;font-size:14px;color:#6b7280;\">Helping families find the perfect name together 🤍</p>
        </div>
        <div style=\"text-align:center;font-size:26px;margin:12px 0 24px;\">👶🍼🎀🧸🌙💙💖</div>
        <div style=\"background:rgba(255,255,255,0.94);border-radius:20px;padding:24px;border:1px solid rgba(244,114,182,0.25);\">
          <h2 style=\"margin:0 0 12px;color:#db2777;font-size:20px;display:flex;align-items:center;gap:8px;\">✨ Reset your password</h2>
          <p>Hi <strong>{first_name}</strong>,</p>
          <p>
            We received a request to reset your BabyNames Hive password. Click the button below within the next hour to choose a new one and get back to brainstorming adorable baby names!
          </p>
          {button_html}
          <p style=\"margin-top:18px;\">
            If you didn’t request a password reset, you can safely ignore this email. Your account will stay snug and secure. 🧸
          </p>
        </div>
        <div style=\"margin-top:24px;font-size:12px;color:#6b7280;text-align:center;line-height:1.6;\">
          Made with 💗 &amp; 💙 by the BabyNames Hive crew.<br />
          Need help? Reach out at <a href=\"mailto:support@babyname-duel.com\" style=\"color:#2563eb;text-decoration:none;font-weight:600;\">support@babyname-duel.com</a>.
        </div>
      </div>
    </body>
    </html>
    """


def _build_invite_email_plain(*, invitee_name: str, inviter_name: str, session_title: str, invite_link: str, existing_user: bool) -> str:
    greeting = f"Hi {invitee_name},"
    if existing_user:
        intro = (
            f"{inviter_name} just added you to the \"{session_title}\" session on BabyNames Hive.\n"
            "Pop back in to add your list or check the latest scores.\n"
        )
        cta = f"Open the session: {invite_link}\n"
    else:
        intro = (
            f"{inviter_name} invited you to join the \"{session_title}\" session on BabyNames Hive.\n"
            "Use the secure link below to accept the invite and start sharing names together.\n"
        )
        cta = f"Accept your invite: {invite_link}\n"
    closing = (
        "\nIf you weren't expecting this message you can ignore it, but feel free to reach out to the inviter if you have questions.\n"
        "\nHappy name brainstorming!\n"
        "— BabyNames Hive"
    )
    return "\n".join([greeting, "", intro, cta, closing])


def _render_invite_email_html(
    *,
    invitee_name: str,
    inviter_name: str,
    session_title: str,
    invite_link: str,
    existing_user: bool,
) -> str:
    action_label = "Open Session" if existing_user else "Accept Invite"
    intro = (
        f"{inviter_name} just added you to the <strong>{session_title}</strong> session."
        if existing_user
        else f"{inviter_name} invited you to join the <strong>{session_title}</strong> session."
    )
    helper_line = (
        "Jump back in to add your list or see how the scores are shaping up."
        if existing_user
        else "Tap the button below to accept and start sharing your favorite names."
    )
    return f"""
    <!DOCTYPE html>
    <html lang=\"en\">
    <head>
      <meta charset=\"UTF-8\" />
      <title>BabyNames Hive invitation</title>
    </head>
    <body style=\"margin:0;padding:0;background:#f5f7ff;font-family:'Poppins','Segoe UI',sans-serif;color:#374151;\">
      <div style=\"max-width:520px;margin:32px auto;background:linear-gradient(135deg,#f9e0ff,#e0f3ff);border-radius:24px;padding:32px;border:1px solid rgba(147,197,253,0.35);box-shadow:0 18px 35px rgba(151,149,240,0.18);\">
        <div style=\"text-align:center;margin-bottom:20px;\">
          <h1 style=\"margin:0;font-size:28px;color:#1d4ed8;letter-spacing:0.5px;\">BabyNames Hive</h1>
          <p style=\"margin:6px 0 0;font-size:14px;color:#6b7280;\">Helping families find the perfect name together 🤍</p>
        </div>
        <div style=\"text-align:center;font-size:26px;margin:12px 0 24px;\">👶🍼🎀🧸🌙💙💖</div>
        <div style=\"background:rgba(255,255,255,0.94);border-radius:20px;padding:24px;border:1px solid rgba(244,114,182,0.25);\">
          <h2 style=\"margin:0 0 12px;color:#db2777;font-size:20px;display:flex;align-items:center;gap:8px;\">🎉 You’re invited!</h2>
          <p>Hi <strong>{invitee_name}</strong>,</p>
          <p>{intro}</p>
          <p>{helper_line}</p>
          <p style=\"text-align:center;margin:24px 0 16px;\">
            <a style=\"display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(135deg,#38bdf8,#f472b6);color:#ffffff;text-decoration:none;font-weight:600;letter-spacing:0.3px;box-shadow:0 12px 24px rgba(244,114,182,0.22);\"
               href=\"{invite_link}\" target=\"_blank\" rel=\"noopener\">
              {action_label}
            </a>
          </p>
          <p style=\"margin-top:18px;\">If the button does not work, copy and paste this link into your browser:<br /><span style=\"word-break:break-all;color:#2563eb;\">{invite_link}</span></p>
          <p style=\"margin-top:18px;\">If this wasn’t meant for you, you can safely ignore it.</p>
        </div>
        <div style=\"margin-top:24px;font-size:12px;color:#6b7280;text-align:center;line-height:1.6;\">
          Made with 💗 &amp; 💙 by the BabyNames Hive crew.<br />
          Need help? Reach out at <a href=\"mailto:support@babyname-duel.com\" style=\"color:#2563eb;text-decoration:none;font-weight:600;\">support@babyname-duel.com</a>.
        </div>
      </div>
    </body>
    </html>
    """


def _send_session_invite_email(
    *,
    session: Session,
    owner_email: str,
    invite_email: str,
    invite_link: str,
    existing_user: bool,
) -> bool:
    session_title = session.title or "BabyNames Hive session"
    invitee_name = _first_name_from_email(invite_email)
    inviter_name = _first_name_from_email(owner_email)
    subject = f"You're invited to {session_title}"
    body = _build_invite_email_plain(
        invitee_name=invitee_name,
        inviter_name=inviter_name,
        session_title=session_title,
        invite_link=invite_link,
        existing_user=existing_user,
    )
    html_body = _render_invite_email_html(
        invitee_name=invitee_name,
        inviter_name=inviter_name,
        session_title=session_title,
        invite_link=invite_link,
        existing_user=existing_user,
    )
    return _send_email(subject=subject, body=body, html_body=html_body, recipient=invite_email)


def _build_invite_link(origin: str, session_id: str, *, token: Optional[str], existing_user: bool, invite_email: str) -> str:
    params = {
        "sid": session_id,
        "participant": "1",
        "mode": "signin" if existing_user else "signup",
        "email": invite_email,
    }
    if token:
        params["token"] = token
    return f"{origin}/?{urlencode(params)}"


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


def _normalize_name_key(value: str) -> str:
    return (value or "").strip().lower()


def _get_name_metadata_map(db, names) -> dict:
    if not names:
        return {}
    keys = {_normalize_name_key(name): name for name in names if name and name.strip()}
    if not keys:
        return {}
    rows = (
        db.query(NameMetadata)
        .filter(NameMetadata.name_key.in_(list(keys.keys())))
        .all()
    )
    results = {}
    for row in rows:
        results[row.name_key] = {
            "info": row.info_text or "",
            "phonetic": row.phonetic or "",
            "audioBase64": row.audio_base64 or "",
            "audioMime": row.audio_mime or "audio/mpeg",
        }
    return results


def _generate_name_fact(name: str) -> Optional[dict]:
    if not OPENAI_API_KEY:
        return None

    prompt = (
        "Respond with a compact JSON object describing the baby name. "
        "Keys: description (max 22 words, friendly origin + meaning) and phonetic (phonetic spelling or IPA). "
        f"Name: {name}."
    )

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    base_payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": "You are a helpful baby name expert."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 180,
        "temperature": 0.6,
    }

    payloads = []
    payload_with_schema = dict(base_payload)
    payload_with_schema["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "name_fact",
            "schema": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "phonetic": {"type": "string"}
                },
                "required": ["description"],
                "additionalProperties": False,
            },
        },
    }
    payloads.append(payload_with_schema)
    payloads.append(dict(base_payload))  # fallback without response_format

    description = ""
    phonetic = ""

    for attempt_payload in payloads:
        try:
            resp = http_requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=attempt_payload,
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
        except http_requests.HTTPError as exc:
            status = getattr(exc.response, "status_code", None) if hasattr(exc, "response") else None
            if status == 400 and attempt_payload is payloads[0]:
                # try fallback without response_format
                continue
            print(f"Failed to generate name metadata for {name}: {exc}")
            return None
        except (http_requests.RequestException, ValueError, KeyError, IndexError) as exc:  # pragma: no cover
            print(f"Failed to generate name metadata for {name}: {exc}")
            return None

        raw_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        raw_text = (raw_text or "").strip()
        if not raw_text and data.get("choices"):
            raw_text = json.dumps(data["choices"][0].get("message", {}), ensure_ascii=False)
        if raw_text:
            try:
                parsed = json.loads(raw_text)
            except json.JSONDecodeError:
                parsed = {}
                description = raw_text
            else:
                description = (parsed.get("description") or "").strip()
                phonetic = (parsed.get("phonetic") or "").strip()
        if description or phonetic:
            break

    description = (description or "").strip()
    if description:
        description = description[:240].strip()
    return {"description": description, "phonetic": phonetic}


def _generate_name_audio(name: str) -> Optional[dict]:
    if not OPENAI_API_KEY:
        return None

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }
    payload = {
        "model": OPENAI_TTS_MODEL,
        "voice": OPENAI_TTS_VOICE,
        "input": name,
        "format": OPENAI_TTS_FORMAT,
    }

    try:
        resp = http_requests.post(
            "https://api.openai.com/v1/audio/speech",
            headers=headers,
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        audio_bytes = resp.content
        if not audio_bytes:
            return None
        encoded = base64.b64encode(audio_bytes).decode("ascii")
        mime = f"audio/{OPENAI_TTS_FORMAT}" if OPENAI_TTS_FORMAT else "audio/mpeg"
        return {"audioBase64": encoded, "audioMime": mime}
    except http_requests.RequestException as exc:  # pragma: no cover
        print(f"Failed to generate pronunciation audio for {name}: {exc}")
        return None


def _prime_name_metadata(db, names) -> dict:
    names = [name.strip() for name in names if name and name.strip()]
    if not names:
        return {}

    existing = _get_name_metadata_map(db, names)
    missing = [name for name in names if _normalize_name_key(name) not in existing]
    if not missing or not OPENAI_API_KEY:
        return existing

    for name in missing:
        key = _normalize_name_key(name)
        info_payload = _generate_name_fact(name)
        if not info_payload:
            continue

        audio_payload = _generate_name_audio(name)

        metadata = NameMetadata(
            name_key=key,
            display_name=name,
            info_text=info_payload.get("description"),
            phonetic=info_payload.get("phonetic"),
            audio_base64=(audio_payload or {}).get("audioBase64"),
            audio_mime=(audio_payload or {}).get("audioMime"),
            source="openai",
        )
        db.add(metadata)
        existing[key] = {
            "info": info_payload.get("description", ""),
            "phonetic": info_payload.get("phonetic", ""),
            "audioBase64": (audio_payload or {}).get("audioBase64", ""),
            "audioMime": (audio_payload or {}).get("audioMime", "audio/mpeg"),
        }
    db.flush()
    return existing

# --- NEW User model ---
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(320), nullable=False, unique=True, index=True)
    display_name = Column(String(120), nullable=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)
    session_tokens = relationship(
        "SessionToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )

class ResetToken(Base):
    __tablename__ = "reset_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(36), nullable=False, unique=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    user = relationship("User")


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, default=now_utc, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    last_used_at = Column(DateTime, default=now_utc, nullable=False)

    user = relationship("User", back_populates="session_tokens")

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
    template_ready = Column(Boolean, nullable=False, default=False)
    tiebreak_active = Column(Boolean, nullable=False, default=False)
    tiebreak_names = Column(Text, nullable=True)
    final_winners = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    members = relationship("Member", back_populates="session", cascade="all, delete-orphan")
    lists = relationship("ListItem", back_populates="session", cascade="all, delete-orphan")
    scores = relationship("Score", back_populates="session", cascade="all, delete-orphan")
    invites = relationship("SessionInvite", back_populates="session", cascade="all, delete-orphan")
    owner_states = relationship("OwnerListState", back_populates="session", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="session", cascade="all, delete-orphan")
    tiebreak_votes = relationship("TieBreakVote", back_populates="session", cascade="all, delete-orphan")

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


class TieBreakVote(Base):
    __tablename__ = "tie_break_votes"

    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    rater_uid = Column(String(64), primary_key=True)
    name = Column(String(100), primary_key=True)
    rank = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="tiebreak_votes")


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
    slot_count = Column(Integer, nullable=False, default=0)

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

    session = relationship("Session", back_populates="notifications")


class NameMetadata(Base):
    __tablename__ = "name_metadata"

    name_key = Column(String(120), primary_key=True)
    display_name = Column(String(120), nullable=False)
    info_text = Column(Text, nullable=True)
    source = Column(String(32), nullable=True)
    phonetic = Column(String(120), nullable=True)
    audio_base64 = Column(Text, nullable=True)
    audio_mime = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=now_utc, nullable=False)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc, nullable=False)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_email = Column(String(320), nullable=True, index=True)
    action = Column(String(64), nullable=False)
    session_id = Column(String(36), nullable=True, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc, nullable=False, index=True)


ensure_schema()
seed_owner_states()

app.logger.info(
    "Email config -> sendgrid=%s, smtp_host=%s, sender=%s, tls=%s",
    bool(SENDGRID_API_KEY),
    SMTP_HOST,
    EMAIL_SENDER,
    SMTP_USE_TLS,
)


def _send_email(*, subject: str, body: str, recipient: str, html_body: Optional[str] = None) -> bool:
    """Basic SMTP email helper; returns True on success."""
    if not EMAIL_SENDER:
        app.logger.info("Email sender not configured; would send to %s", recipient)
        return False

    if SENDGRID_API_KEY and SendGridAPIClient and Mail and Content:
        sg_message = Mail(
            from_email=EMAIL_SENDER,
            to_emails=recipient,
            subject=subject,
        )
        sg_message.add_content(Content("text/plain", body))
        sg_message.add_content(Content("text/html", html_body or body.replace("\n", "<br>")))
        try:
            app.logger.info("Attempting to send email via SendGrid to %s", recipient)
            sg = SendGridAPIClient(SENDGRID_API_KEY)
            response = sg.send(sg_message)
            if 200 <= response.status_code < 300:
                app.logger.info("SendGrid email dispatched to %s", recipient)
                return True
            app.logger.error(
                "SendGrid email failed for %s: status=%s body=%s",
                recipient,
                response.status_code,
                response.body,
            )
        except Exception as exc:  # pragma: no cover - dependent on SendGrid runtime
            app.logger.error("SendGrid email error for %s: %s", recipient, exc)
    elif SENDGRID_API_KEY and (not SendGridAPIClient or not Mail or not Content):
        app.logger.warning("SendGrid configured but sendgrid package not installed; skipping SendGrid delivery.")

    if not SMTP_HOST:
        app.logger.info("SMTP host not configured; skipping SMTP fallback for %s", recipient)
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = EMAIL_SENDER
    message["To"] = recipient
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        app.logger.info(
            "Attempting to send email to %s via %s:%s (TLS=%s, user=%s)",
            recipient,
            SMTP_HOST,
            SMTP_PORT,
            SMTP_USE_TLS,
            SMTP_USERNAME,
        )
        context = ssl.create_default_context(cafile=certifi.where())
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            if SMTP_DEBUG:
                server.set_debuglevel(1)
            server.ehlo()
            if SMTP_USE_TLS:
                server.starttls(context=context)
                server.ehlo()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(message)
        app.logger.info("Password reset email dispatched to %s", recipient)
        return True
    except Exception as exc:  # pragma: no cover - dependent on SMTP runtime
        app.logger.error("Failed to send email to %s: %s", recipient, exc)
        return False


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
                "emailSent": False,
            })
            continue

        if user_exists:
            db.add(Member(session_id=session_id, uid=invite_email, role="participant"))
            _ensure_owner_list_state(db, session_id, invite_email)
            # remove any pending invite tokens for cleanliness
            db.query(SessionInvite).filter_by(session_id=session_id, email=invite_email).delete()
            member_link = _build_invite_link(
                origin,
                session_id,
                token=None,
                existing_user=True,
                invite_email=invite_email,
            )
            email_sent = _send_session_invite_email(
                session=session,
                owner_email=owner_email,
                invite_email=invite_email,
                invite_link=member_link,
                existing_user=True,
            )
            results.append({
                "email": invite_email,
                "status": "added",
                "existingUser": True,
                "link": member_link,
                "emailSent": email_sent,
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

        link = _build_invite_link(
            origin,
            session_id,
            token=invite_row.token,
            existing_user=False,
            invite_email=invite_email,
        )
        email_sent = _send_session_invite_email(
            session=session,
            owner_email=owner_email,
            invite_email=invite_email,
            invite_link=link,
            existing_user=False,
        )
        results.append({
            "email": invite_email,
            "status": "invite-sent",
            "existingUser": False,
            "link": link,
            "emailSent": email_sent,
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


def _score_totals(db, session_id: str) -> dict:
    rows = db.query(Score).filter_by(session_id=session_id).all()
    totals = {}
    for row in rows:
        totals[row.name] = totals.get(row.name, 0) + row.score_value
    return totals


def _first_place_tie_names(totals: dict) -> list:
    if not totals:
        return []
    lowest = min(totals.values())
    return [name for name, value in totals.items() if value == lowest]


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
        "templateReady": bool(session.template_ready),
        "tieBreakActive": bool(session.tiebreak_active),
        "finalWinners": _load_json_array(session.final_winners),
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
        "templateReady": bool(session.template_ready),
        "tieBreak": {
            "active": bool(session.tiebreak_active),
            "names": _load_json_array(session.tiebreak_names) if session.tiebreak_active else [],
        },
        "finalWinners": _load_json_array(session.final_winners),
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
    try:
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
        db.flush()
        token = _issue_session_token(db, user)
        _log_activity(
            db,
            actor=email,
            action="user.signup",
            details={"displayName": full_name},
        )
        db.commit()
        payload = {
            "ok": True,
            "user": _user_payload(user),
            "token": token,
            "expiresIn": SESSION_TOKEN_TTL_HOURS * 3600,
        }
        response = jsonify(payload)
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# --- Login endpoint (MySQL-backed) ---
@app.route("/api/login", methods=["POST"])
def api_login():
    db = SessionLocal()
    try:
        data = request.get_json(force=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        user = db.query(User).filter_by(email=email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"ok": False, "error": "Invalid credentials"}), 401

        token = _issue_session_token(db, user)
        _log_activity(
            db,
            actor=email,
            action="user.login",
            details={"method": "password"},
        )
        db.commit()
        payload = {
            "ok": True,
            "user": _user_payload(user),
            "token": token,
            "expiresIn": SESSION_TOKEN_TTL_HOURS * 3600,
        }
        response = jsonify(payload)
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# --- Google OAuth login endpoint ---
@app.route("/api/google-login", methods=["POST"])
def api_google_login():
    db = SessionLocal()
    try:
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

        user = db.query(User).filter_by(email=email).first()
        if not user:
            placeholder_password = generate_password_hash(_uuid())
            user = User(email=email, display_name=display_name, password_hash=placeholder_password)
            db.add(user)
            created = True
        else:
            if display_name and user.display_name != display_name:
                user.display_name = display_name
        db.flush()
        session_token = _issue_session_token(db, user)
        _log_activity(
            db,
            actor=user.email,
            action="user.login",
            details={"method": "google", "created": created},
        )
        db.commit()

        payload_user = {
            **_user_payload(user),
            "uid": user.email,
            "photoURL": photo_url,
            "emailVerified": email_verified,
            "provider": "google",
            "created": created,
        }
        payload = {
            "ok": True,
            "user": payload_user,
            "token": session_token,
            "expiresIn": SESSION_TOKEN_TTL_HOURS * 3600,
        }
        response = jsonify(payload)
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as exc:
        db.rollback()
        print("Failed to persist Google user", exc)
        return jsonify({"ok": False, "error": "Unable to persist user"}), 500
    finally:
        db.close()


@app.route("/api/logout", methods=["POST"])
def api_logout():
    db = SessionLocal()
    try:
        _require_user(db)
        _revoke_current_token(db)
        db.commit()
        response = jsonify({"ok": True})
        response.delete_cookie("bnd_session")
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# --- Session APIs ---
def _ensure_member(db, session_id: str, uid: str):
    return db.query(Member).filter_by(session_id=session_id, uid=uid).first()


@app.route("/api/sessions", methods=["POST"])
def api_create_session():
    db = SessionLocal()
    try:
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        title = (data.get("title") or "Untitled session").strip()[:200]
        required_names = data.get("requiredNames") or data.get("maxNames") or 10
        name_focus = (data.get("nameFocus") or "mix").strip().lower()
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
            template_ready=False,
        )
        member = Member(session_id=sid, uid=email, role="owner")
        owner_state = OwnerListState(session_id=sid, owner_uid=email, status="draft")

        try:
            db.add(session)
            db.add(member)
            db.add(owner_state)
            db.flush()
            _log_activity(
                db,
                actor=email,
                action="session.create",
                session_id=sid,
                details={
                    "title": session.title,
                    "requiredNames": required_names,
                    "nameFocus": name_focus,
                    "invitedCount": 0,
                },
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
            "requiredNames": required_names,
            "nameFocus": name_focus,
            "ownerIds": [email],
            "voterIds": [],
            "createdBy": email,
            "viewerRole": "owner",
            "invitesLocked": False,
            "templateReady": False,
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
    db = SessionLocal()
    try:
        user = _require_user(db)
        request_email = _normalize_email(request.args.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        if not email:
            return jsonify({"ok": False, "error": "Authenticated user missing email"}), 400
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
    if not sid:
        return jsonify({"ok": False, "error": "Session id required"}), 400

    db = SessionLocal()
    try:
        user = _require_user(db)
        request_email = _normalize_email(request.args.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        if not email:
            return jsonify({"ok": False, "error": "Authenticated user missing email"}), 400
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
                "slotCount": state.slot_count or 0,
            }
            for state in state_rows
        }
        session_doc["listStates"] = state_map
        session_doc["viewerRole"] = member.role if member else None
        session_doc["invitesLocked"] = bool(session.invites_locked)
        tie_info = session_doc.get("tieBreak", {})
        if tie_info.get("active") and email:
            submitted = bool(
                db.query(TieBreakVote)
                .filter_by(session_id=sid, rater_uid=email)
                .first()
            )
            tie_info["submitted"] = submitted
        else:
            tie_info.setdefault("submitted", False)
        session_doc["tieBreak"] = tie_info
        if include_tokens:
            invite_origin = _compute_invite_origin(request)
            invite_rows = (
                db.query(SessionInvite)
                .filter_by(session_id=sid)
                .order_by(SessionInvite.created_at.asc())
                .all()
            )
            session_doc["pendingInvites"] = [
                {
                    "email": row.email,
                    "role": row.role,
                    "sentAt": _isoformat(row.created_at),
                    "link": _build_invite_link(
                        invite_origin,
                        sid,
                        token=row.token,
                        existing_user=False,
                        invite_email=row.email,
                    ),
                }
                for row in invite_rows
            ]

        list_rows = (
            db.query(ListItem)
            .filter_by(session_id=sid)
            .order_by(ListItem.owner_uid, ListItem.self_rank)
            .all()
        )

        metadata_map = _get_name_metadata_map(db, [row.name for row in list_rows])

        lists = {}
        for row in list_rows:
            entry = lists.setdefault(
                row.owner_uid,
                {"names": [], "selfRanks": {}, "status": state_map.get(row.owner_uid, {}).get("status", "draft"), "facts": {}},
            )
            entry["names"].append(row.name)
            entry["selfRanks"][row.name] = row.self_rank
            fact_value = metadata_map.get(_normalize_name_key(row.name))
            if fact_value:
                entry.setdefault("facts", {})[row.name] = fact_value

        # ensure every owner appears in lists even if empty
        for owner_uid, state in state_map.items():
            lists.setdefault(
                owner_uid,
                {"names": [], "selfRanks": {}, "status": state.get("status", "draft"), "facts": {}},
            )

        viewer_uid = email
        filtered_lists = {}
        for owner_uid, data in lists.items():
            status = data.get("status", "draft")
            if owner_uid != viewer_uid and status != "submitted":
                continue
            data.setdefault("facts", {})
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

        if not session.invites_locked and session.status != "completed":
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
            _log_activity(
                db,
                actor=email,
                action="session.join",
                session_id=sid,
                details={"role": existing.role, "method": "rejoin"},
            )
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
            _log_activity(
                db,
                actor=email,
                action="session.join",
                session_id=sid,
                details={"role": "participant", "method": "invite"},
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        owner_email = _normalize_email(user.email)
        if request_email and request_email != owner_email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
        if not session.template_ready:
            return jsonify({"ok": False, "error": "Create your list template before inviting participants."}), 409

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
            _log_activity(
                db,
                actor=owner_email,
                action="participants.invite",
                session_id=sid,
                details={"count": len(results)},
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print("Failed to invite participants", exc)
            return jsonify({"ok": False, "error": "Unable to invite participants"}), 500

        return jsonify({"ok": True, "results": results})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/tiebreak", methods=["GET"])
def api_tiebreak_status(sid):
    db = SessionLocal()
    try:
        user = _require_user(db)
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, user.email)
        if not member and user.email != session.created_by:
            return jsonify({"ok": False, "error": "Not a participant"}), 403

        names = _load_json_array(session.tiebreak_names) if session.tiebreak_active else []
        submitted = False
        if session.tiebreak_active and member:
            submitted = bool(
                db.query(TieBreakVote)
                .filter_by(session_id=sid, rater_uid=user.email)
                .first()
            )

        payload = {
            "active": bool(session.tiebreak_active),
            "names": names,
            "submitted": submitted,
            "finalWinners": _load_json_array(session.final_winners),
        }
        return jsonify({"ok": True, "tieBreak": payload})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/tiebreak/start", methods=["POST"])
def api_tiebreak_start(sid):
    db = SessionLocal()
    try:
        user = _require_user(db)
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        email = _normalize_email(user.email)
        if session.created_by != email:
            return jsonify({"ok": False, "error": "Only the owner can start a tie-break"}), 403
        if session.status == "completed":
            return jsonify({"ok": False, "error": "Session already completed"}), 409
        if not session.invites_locked:
            return jsonify({"ok": False, "error": "Close invites before starting a tie-break"}), 409
        if session.tiebreak_active:
            return jsonify({"ok": False, "error": "Tie-break already active"}), 409

        totals = _score_totals(db, sid)
        tied_names = _first_place_tie_names(totals)
        if len(tied_names) < 2:
            return jsonify({"ok": False, "error": "No tie to resolve"}), 409

        session.tiebreak_active = True
        session.tiebreak_names = json.dumps(tied_names)
        session.final_winners = None
        db.query(TieBreakVote).filter_by(session_id=sid).delete(synchronize_session=False)

        for member in db.query(Member).filter_by(session_id=sid).all():
            if member.uid == email:
                continue
            _create_notification(
                db,
                user_email=member.uid,
                session_id=sid,
                type_="tiebreak_started",
                payload={"sid": sid, "names": tied_names},
            )

        _log_activity(
            db,
            actor=email,
            action="tiebreak.start",
            session_id=sid,
            details={"names": tied_names},
        )
        db.commit()
        return jsonify({"ok": True, "names": tied_names})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/tiebreak/votes", methods=["POST"])
def api_tiebreak_vote(sid):
    db = SessionLocal()
    try:
        user = _require_user(db)
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if not session.tiebreak_active:
            return jsonify({"ok": False, "error": "Tie-break is not active"}), 409

        member = _ensure_member(db, sid, user.email)
        if not member:
            return jsonify({"ok": False, "error": "Not a participant"}), 403

        data = request.get_json(force=True) or {}
        ranks = data.get("ranks")
        names = _load_json_array(session.tiebreak_names)
        if not isinstance(ranks, dict) or not names:
            return jsonify({"ok": False, "error": "ranks object required"}), 400

        try:
            parsed = {name: int(ranks[name]) for name in names if name in ranks}
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Ranks must be integers"}), 400

        if len(parsed) != len(names):
            return jsonify({"ok": False, "error": "Rank every name"}), 400

        values = list(parsed.values())
        limit = len(names)
        if any(value < 1 or value > limit for value in values):
            return jsonify({"ok": False, "error": f"Ranks must be between 1 and {limit}"}), 400
        if len(set(values)) != len(values):
            return jsonify({"ok": False, "error": "Use each rank only once"}), 400

        db.query(TieBreakVote).filter_by(session_id=sid, rater_uid=user.email).delete(synchronize_session=False)
        now = now_utc()
        for name, value in parsed.items():
            db.add(TieBreakVote(session_id=sid, rater_uid=user.email, name=name, rank=value, created_at=now))

        _log_activity(
            db,
            actor=user.email,
            action="tiebreak.vote",
            session_id=sid,
            details={"names": names},
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/tiebreak/close", methods=["POST"])
def api_tiebreak_close(sid):
    db = SessionLocal()
    try:
        user = _require_user(db)
        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        email = _normalize_email(user.email)
        if session.created_by != email:
            return jsonify({"ok": False, "error": "Only the owner can close the tie-break"}), 403
        if not session.tiebreak_active:
            winners = _load_json_array(session.final_winners)
            return jsonify({"ok": True, "winners": winners, "alreadyClosed": True})

        names = _load_json_array(session.tiebreak_names)
        votes = db.query(TieBreakVote).filter_by(session_id=sid).all()
        totals = {name: 0 for name in names}
        if votes:
            for row in votes:
                if row.name in totals:
                    totals[row.name] += row.rank
        tied = names if not votes else _first_place_tie_names(totals)
        winners = tied if tied else names

        session.final_winners = json.dumps(winners)
        session.tiebreak_active = False
        session.tiebreak_names = None
        session.status = "completed"

        for member in db.query(Member).filter_by(session_id=sid).all():
            if member.uid == email:
                continue
            _create_notification(
                db,
                user_email=member.uid,
                session_id=sid,
                type_="tiebreak_closed",
                payload={"sid": sid, "winners": winners},
            )

        _log_activity(
            db,
            actor=email,
            action="tiebreak.close",
            session_id=sid,
            details={"winners": winners},
        )
        db.commit()
        return jsonify({"ok": True, "winners": winners})
    finally:
        db.close()


@app.route("/api/sessions/<sid>/participants", methods=["DELETE"])
def api_remove_participant(sid):
    db = SessionLocal()
    try:
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        owner_email = _normalize_email(user.email)
        if request_email and request_email != owner_email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
            _log_activity(
                db,
                actor=owner_email,
                action="participants.remove",
                session_id=sid,
                details={"target": target_email, "removed": False},
            )
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
            _log_activity(
                db,
                actor=owner_email,
                action="participants.remove",
                session_id=sid,
                details={"target": target_email, "removed": True},
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
        _log_activity(
            db,
            actor=email,
            action="invites.lock",
            session_id=sid,
            details={"title": session.title},
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        names = data.get("names") or []
        self_ranks = data.get("selfRanks") or {}
        finalize = bool(data.get("finalize"))
        slot_count_raw = data.get("slotCount")

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404
        if session.status == "archived":
            return jsonify({"ok": False, "error": "Session archived"}), 409
        if session.status == "completed":
            return jsonify({"ok": False, "error": "Session completed; lists are locked"}), 409

        current_max = session.max_names or 10
        slot_count = None
        if slot_count_raw is not None:
            try:
                slot_count = int(slot_count_raw)
            except (TypeError, ValueError):
                return jsonify({"ok": False, "error": "slotCount must be an integer"}), 400
        if slot_count is None or slot_count <= 0:
            slot_count = current_max

        if session.created_by == email:
            if slot_count < 4 or slot_count > 100:
                return jsonify({"ok": False, "error": "List template must be between 4 and 100 names"}), 400
            focus = session.name_focus or "mix"
            if focus == "mix" and slot_count % 4 != 0:
                return jsonify({"ok": False, "error": "For mix sessions, names must be a multiple of 4"}), 400
            if focus in {"girl", "boy"} and slot_count % 2 != 0:
                return jsonify({"ok": False, "error": "For single-focus sessions, names must be an even number"}), 400
            if slot_count != current_max:
                session.max_names = slot_count
            session.template_ready = True

        max_names = session.max_names or slot_count or 10

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
            state.slot_count = slot_count if email == session.created_by else max_names
            if finalize:
                _prime_name_metadata(db, [name for name, _ in cleaned])
            for target in notify_targets:
                _create_notification(
                    db,
                    user_email=target,
                    session_id=sid,
                    type_="list_submitted",
                    payload={"sid": sid, "by": email},
                )
            _log_activity(
                db,
                actor=email,
                action="list.submit" if finalize else "list.save",
                session_id=sid,
                details={"nameCount": len(cleaned), "finalize": finalize},
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
        if session.tiebreak_active:
            return jsonify({"ok": False, "error": "Tie-break in progress; scoring closed"}), 409

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
            _log_activity(
                db,
                actor=email,
                action="score.submit",
                session_id=sid,
                details={
                    "listOwner": list_owner_uid,
                    "name": name,
                    "score": score_value,
                    "completed": completed,
                },
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
    db = SessionLocal()
    try:
        user = _require_user(db)
        request_email = _normalize_email(request.args.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        if not email:
            return jsonify({"ok": False, "error": "Authenticated user missing email"}), 400
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        sender = _normalize_email(user.email)
        if request_email and request_email != sender:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
            _log_activity(
                db,
                actor=sender,
                action="message.send" if kind != "nudge" else "message.nudge",
                session_id=sid,
                details={
                    "recipient": recipient,
                    "kind": kind,
                    "length": len(body),
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403

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
            _log_activity(
                db,
                actor=email,
                action="session.archive",
                session_id=sid,
                details={"title": session.title},
            )
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403

        if not email or not _is_valid_email(email):
            return jsonify({"ok": False, "error": "Valid email required"}), 400

        session = db.query(Session).filter_by(id=sid).first()
        if not session:
            return jsonify({"ok": False, "error": "Session not found"}), 404

        member = _ensure_member(db, sid, email)
        if not member or member.role != "owner":
            return jsonify({"ok": False, "error": "Only owners can delete"}), 403

        try:
            db.query(Message).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(Score).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(ListItem).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(SessionInvite).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(OwnerListState).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(Notification).filter_by(session_id=sid).delete(synchronize_session=False)
            db.query(Member).filter_by(session_id=sid).delete(synchronize_session=False)
            db.delete(session)
            _log_activity(
                db,
                actor=email,
                action="session.delete",
                session_id=sid,
                details={"title": session.title},
            )
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
    try:
        db.add(reset)
        _log_activity(
            db,
            actor=email,
            action="user.reset_password_request",
            details={"expiresAt": _isoformat(expires_at)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    reset_link = _ensure_reset_link(token)

    subject = "Reset your BabyNames Hive password"
    if reset_link:
        body = (
            "Hello!\n\n"
            "We received a request to reset your BabyNames Hive password. "
            "Click the link below within the next hour to choose a new password:\n\n"
            f"{reset_link}\n\n"
            "If you didn't request this, you can safely ignore the message."
        )
    else:
        body = (
            "Hello!\n\n"
            "We received a request to reset your BabyNames Hive password, but a link wasn't available. "
            "Please open the app and request another reset link or contact support if you need help."
        )

    html_body = _render_reset_email_html(
        first_name=_first_name_from_email(email),
        reset_link=reset_link,
    )

    email_sent = _send_email(subject=subject, body=body, html_body=html_body, recipient=email)

    if email_sent:
        return jsonify({"ok": True, "message": "If the email exists, a reset link has been sent."}), 200

    # Fallback for development/testing when email isn't configured
    response = {
        "ok": True,
        "token": token,
        "message": "Reset token generated (email delivery not configured).",
    }
    if reset_link:
        response["resetUrl"] = reset_link
    return jsonify(response), 200

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
    try:
        user.password_hash = hashed
        db.delete(reset)  # One-time use
        db.query(SessionToken).filter_by(user_id=user.id).delete(synchronize_session=False)
        _log_activity(
            db,
            actor=user.email,
            action="user.reset_password",
            details=None,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify({"ok": True, "message": "Password reset successfully."}), 200


@app.route("/api/notifications", methods=["GET"])
def api_notifications():
    db = SessionLocal()
    try:
        user = _require_user(db)
        request_email = _normalize_email(request.args.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
        if not email:
            return jsonify({"ok": False, "error": "Authenticated user missing email"}), 400
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
        user = _require_user(db)
        data = request.get_json(force=True) or {}
        request_email = _normalize_email(data.get("email"))
        email = _normalize_email(user.email)
        if request_email and request_email != email:
            return jsonify({"ok": False, "error": "Authenticated email mismatch"}), 403
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
            _log_activity(
                db,
                actor=email,
                action="notifications.mark_read",
                details={"count": len(ids)},
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
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", "5050"))
    app.run(debug=True, host=host, port=port)
