
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

import os
from datetime import datetime
from uuid import uuid4

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Text,
    ForeignKey, UniqueConstraint, text as sql_text
)
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session, relationship

# ----------------------------------------------------------------------------
# App & Config
# ----------------------------------------------------------------------------

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
app = Flask(__name__, static_folder="dist", static_url_path="/")

CORS(app, resources={r"/api/*": {"origins": os.getenv("ALLOWED_ORIGIN", "*")}})

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Example: mysql+pymysql://bnd_user:***@127.0.0.1:3306/bnd")

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

def now_utc():
    # naive UTC datetime stored in DB
    return datetime.utcnow()

def _uuid() -> str:
    return uuid4().hex

# ---------------- Models -----------------

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(36), primary_key=True)  # uuid hex
    title = Column(String(200), nullable=False)
    created_by = Column(String(64), nullable=False)
    max_owners = Column(Integer, nullable=False, default=2)
    status = Column(String(16), nullable=False, default="active")
    invite_owner_token = Column(String(64), nullable=False)
    invite_voter_token = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    members = relationship("Member", back_populates="session", cascade="all, delete-orphan")
    lists = relationship("ListItem", back_populates="session", cascade="all, delete-orphan")
    scores = relationship("Score", back_populates="session", cascade="all, delete-orphan")

class Member(Base):
    __tablename__ = "members"
    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    user_id = Column(String(64), primary_key=True)
    role = Column(String(16), nullable=False)  # "owner" | "voter"
    joined_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="members")

class ListItem(Base):
    __tablename__ = "list_items"
    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    owner_uid = Column(String(64), primary_key=True)
    name = Column(String(200), primary_key=True)  # one row per name
    self_rank = Column(Integer, nullable=False)

    session = relationship("Session", back_populates="lists")

class Score(Base):
    __tablename__ = "scores"
    session_id = Column(String(36), ForeignKey("sessions.id"), primary_key=True)
    list_owner_uid = Column(String(64), primary_key=True)
    rater_uid = Column(String(64), primary_key=True)
    score_value = Column(Integer, primary_key=True)  # 1..10 uniquely per rater per list
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=now_utc, nullable=False)

    session = relationship("Session", back_populates="scores")

    __table_args__ = (
        # guard against same 1..10 reuse per (list_owner_uid, rater_uid)
        UniqueConstraint("session_id", "list_owner_uid", "rater_uid", "score_value", name="uq_score_unique_value"),
    )

# Create tables
Base.metadata.create_all(engine)

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def json_body():
    try:
        return request.get_json(force=True) or {}
    except Exception:
        return {}

def current_uid():
    # Dev-only identity: allow header override; swap to Firebase JWT later
    uid = request.headers.get("X-Dev-Uid")
    if not uid:
        uid = "dev-1"
    return uid

# ----------------------------------------------------------------------------
# Health & DB check
# ----------------------------------------------------------------------------

@app.get("/api/health")
def api_health():
    return jsonify({"ok": True}), 200

@app.get("/api/dbcheck")
def api_dbcheck():
    try:
        with engine.connect() as conn:
            conn.execute(sql_text("SELECT 1"))
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ----------------------------------------------------------------------------
# Sessions
# ----------------------------------------------------------------------------

@app.post("/api/sessions")
def create_session():
    data = json_body()
    title = (data.get("title") or "Untitled").strip()
    try:
        max_owners = int(data.get("maxOwners", 2))
    except Exception:
        max_owners = 2
    max_owners = 3 if max_owners == 3 else 2

    sid = _uuid()
    owner_token = _uuid()
    voter_token = _uuid()
    uid = current_uid()

    db = SessionLocal()
    try:
        rec = Session(
            id=sid,
            title=title,
            created_by=uid,
            max_owners=max_owners,
            status="active",
            invite_owner_token=owner_token,
            invite_voter_token=voter_token,
        )
        db.add(rec)
        db.add(Member(session_id=sid, user_id=uid, role="owner"))
        db.commit()
        return jsonify({"sid": sid, "ownerToken": owner_token, "voterToken": voter_token}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@app.post("/api/sessions/<sid>/join")
def join_with_token(sid):
    data = json_body()
    token = data.get("token") or ""
    as_owner = bool(data.get("asOwner"))
    uid = current_uid()

    db = SessionLocal()
    try:
        sess = db.get(Session, sid)
        if not sess or sess.status != "active":
            return jsonify({"error": "Session not found"}), 404

        if as_owner:
            if token != sess.invite_owner_token:
                return jsonify({"error": "Invalid owner token"}), 400
            current_owner_count = db.query(Member).filter_by(session_id=sid, role="owner").count()
            if current_owner_count >= (sess.max_owners or 2):
                return jsonify({"error": "Owner limit reached"}), 400
            # upsert member as owner
            m = db.query(Member).filter_by(session_id=sid, user_id=uid).one_or_none()
            if m:
                m.role = "owner"
            else:
                db.add(Member(session_id=sid, user_id=uid, role="owner"))
        else:
            if token != sess.invite_voter_token:
                return jsonify({"error": "Invalid voter token"}), 400
            # upsert member as voter
            m = db.query(Member).filter_by(session_id=sid, user_id=uid).one_or_none()
            if m:
                m.role = "voter"
            else:
                db.add(Member(session_id=sid, user_id=uid, role="voter"))

        db.commit()
        return jsonify({"ok": True}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@app.put("/api/sessions/<sid>/lists")
def upsert_owner_list(sid):
    data = json_body()
    names = data.get("names") or []
    self_ranks = data.get("selfRanks") or {}
    uid = current_uid()

    # guard constraints
    if len(names) != 10:
        return jsonify({"error": "Exactly 10 names required"}), 400
    if len(set(n.strip().lower() for n in names)) != 10:
        return jsonify({"error": "Names must be unique"}), 400
    ranks = list(self_ranks.values())
    try:
        ranks = [int(x) for x in ranks]
    except Exception:
        return jsonify({"error": "Ranks must be integers"}), 400
    if sorted(ranks) != list(range(1, 11)):
        return jsonify({"error": "Ranks must be 1..10 and used once"}), 400

    db = SessionLocal()
    try:
        sess = db.get(Session, sid)
        if not sess or sess.status != "active":
            return jsonify({"error": "Session not found"}), 404
        # Ensure caller is an owner
        role = db.query(Member).filter_by(session_id=sid, user_id=uid).one_or_none()
        if not role or role.role != "owner":
            return jsonify({"error": "Only owners can save their list"}), 403

        # Delete previous rows for this owner
        db.query(ListItem).filter_by(session_id=sid, owner_uid=uid).delete()
        # Insert new rows
        for n in names:
            db.add(ListItem(session_id=sid, owner_uid=uid, name=n, self_rank=int(self_ranks[n])))
        db.commit()
        return jsonify({"ok": True}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@app.post("/api/sessions/<sid>/scores")
def submit_score(sid):
    data = json_body()
    list_owner_uid = data.get("listOwnerUid")
    name = data.get("name")
    try:
        score_value = int(data.get("scoreValue"))
    except Exception:
        return jsonify({"error": "Invalid scoreValue"}), 400

    uid = current_uid()

    db = SessionLocal()
    try:
        sess = db.get(Session, sid)
        if not sess or sess.status != "active":
            return jsonify({"error": "Session not found"}), 404

        # Disallow owner scoring own list
        if uid == list_owner_uid:
            return jsonify({"error": "Owner cannot score own list"}), 400

        # Validate name exists in owner's list
        exists = db.query(ListItem).filter_by(session_id=sid, owner_uid=list_owner_uid, name=name).count()
        if not exists:
            return jsonify({"error": "Name not found in owner's list"}), 400

        rec = Score(
            session_id=sid,
            list_owner_uid=list_owner_uid,
            rater_uid=uid,
            score_value=score_value,
            name=name,
        )
        db.add(rec)
        db.commit()
        return jsonify({"ok": True}), 200
    except Exception as e:
        db.rollback()
        # Likely uniqueness violation means reused score value
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@app.delete("/api/sessions/<sid>")
def archive_session(sid):
    uid = current_uid()
    db = SessionLocal()
    try:
        sess = db.get(Session, sid)
        if not sess:
            return jsonify({"error": "Session not found"}), 404
        # only creators or owners can archive
        is_owner = db.query(Member).filter_by(session_id=sid, user_id=uid, role="owner").count() > 0
        if not (uid == sess.created_by or is_owner):
            return jsonify({"error": "Not allowed"}), 403
        sess.status = "archived"
        db.commit()
        return jsonify({"ok": True}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@app.get("/api/sessions/<sid>/snap")
def session_snapshot(sid):
    """Return session core + lists + scores for polling by frontend."""
    db = SessionLocal()
    try:
        sess = db.get(Session, sid)
        if not sess:
            return jsonify({"error": "Session not found"}), 404

        # Build lists map: owner_uid -> {names, selfRanks}
        lists_map = {}
        rows = db.query(ListItem).filter_by(session_id=sid).all()
        for li in rows:
            m = lists_map.setdefault(li.owner_uid, {"names": [], "selfRanks": {}})
            m["names"].append(li.name)
            m["selfRanks"][li.name] = li.self_rank

        # Scores array
        sc = db.query(Score).filter_by(session_id=sid).all()
        scores_arr = [
            {
                "listOwnerUid": r.list_owner_uid,
                "raterUid": r.rater_uid,
                "scoreValue": r.score_value,
                "name": r.name,
                "createdAt": r.created_at.isoformat(),
            }
            for r in sc
        ]

        out = {
            "session": {
                "id": sess.id,
                "title": sess.title,
                "createdBy": sess.created_by,
                "maxOwners": sess.max_owners,
                "status": sess.status,
                "inviteOwnerToken": sess.invite_owner_token,
                "inviteVoterToken": sess.invite_voter_token,
                "createdAt": sess.created_at.isoformat(),
            },
            "lists": lists_map,
            "scores": scores_arr,
        }
        return jsonify(out), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
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
    app.run(debug=True, host="127.0.0.1", port=5000)
