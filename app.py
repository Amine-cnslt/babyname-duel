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

import os
import re
from datetime import datetime, timedelta
from uuid import uuid4

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Text,
    ForeignKey, UniqueConstraint, text as sql_text
)
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session, relationship
from dotenv import load_dotenv

# Load .env.local using an absolute path (more reliable than relative cwd)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env.local")
print("DEBUG: CWD =", os.getcwd())
print("DEBUG: ENV_PATH =", ENV_PATH, "exists?", os.path.exists(ENV_PATH))

load_dotenv(dotenv_path=ENV_PATH, override=True)

print("DEBUG: DATABASE_URL =", os.getenv("DATABASE_URL"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Example: mysql+pymysql://bnd_user:***@127.0.0.1:3306/bnd"
    )

# ----------------------------------------------------------------------------
# App & Config
# ----------------------------------------------------------------------------

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
app = Flask(__name__, static_folder="dist", static_url_path="/")

@app.route("/api/test", methods=["GET"])
def test_api():
    return {"message": "Flask backend is working!"}, 200

CORS(app, resources={r"/api/*": {"origins": os.getenv("ALLOWED_ORIGIN", "*")}})

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
