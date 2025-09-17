import os
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("ALLOWED_ORIGIN", "http://localhost:5173")

from app import app, Base, engine, SessionLocal  # noqa: E402  Imported after env vars are set


@pytest.fixture(name="client")
def client_fixture():
    with app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def _reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    SessionLocal.remove()
