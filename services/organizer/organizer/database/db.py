"""Engine/session management and schema initialisation."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import sessionmaker

from ..config import get_config
from .models import Base

_engine: Engine | None = None
_factory: sessionmaker[OrmSession] | None = None


def get_engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        cfg = get_config()
        url = f"sqlite:///{cfg.db_path.as_posix()}"
        _engine = create_engine(
            url,
            connect_args={"check_same_thread": False, "timeout": 15},
            future=True,
        )

        @event.listens_for(_engine, "connect")
        def _set_pragmas(dbapi_connection, _record):  # pragma: no cover - driver hook
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=15000")
            cursor.close()

        _factory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)


def reset_engine() -> None:
    """Drop cached engine handles (used when the data dir changes in tests)."""
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _factory = None


def get_session() -> Iterator[OrmSession]:
    """FastAPI dependency yielding a database session."""
    get_engine()
    assert _factory is not None
    session = _factory()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[OrmSession]:
    """Context manager for background jobs and scripts."""
    get_engine()
    assert _factory is not None
    session = _factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
