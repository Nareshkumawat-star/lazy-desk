from __future__ import annotations

import os
import tempfile

import pytest

DATA_DIR = tempfile.mkdtemp(prefix="lazydesk-tests-")
os.environ["LAZYDESK_DATA_DIR"] = DATA_DIR
os.environ["LAZYDESK_SERVICE_TOKEN"] = "test-token"
os.environ["LAZYDESK_LOG_LEVEL"] = "warning"
# A deployed frontend origin, so the CORS wiring for a hosted site is covered.
os.environ["LAZYDESK_ALLOWED_ORIGINS"] = "https://lazydesk-site.onrender.com"

from fastapi.testclient import TestClient  # noqa: E402

from organizer.config import get_config  # noqa: E402
from organizer.database.db import Base, get_engine, reset_engine  # noqa: E402
from organizer.main import app  # noqa: E402

TOKEN_HEADERS = {"X-LazyDesk-Token": "test-token"}


@pytest.fixture()
def client(tmp_path):
    reset_engine()
    get_config.cache_clear()
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as test_client:
        yield test_client
    reset_engine()


@pytest.fixture()
def auth_headers():
    return dict(TOKEN_HEADERS)


@pytest.fixture()
def messy_folder(tmp_path):

    root = tmp_path / "MessyDownloads"
    (root / "nested").mkdir(parents=True)
    (root / "report.pdf").write_text("quarterly report", encoding="utf-8")
    (root / "photo.jpg").write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
    (root / "script.py").write_text("print('hello')", encoding="utf-8")
    (root / "notes.txt").write_text("meeting notes", encoding="utf-8")
    (root / "archive.zip").write_bytes(b"PK\x03\x04fakezip")
    (root / "mystery.xyz").write_text("unknown", encoding="utf-8")
    (root / "nested" / "clip.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    return root
