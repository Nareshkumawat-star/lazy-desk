"""Shared dependencies."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from ..database.db import get_session
from ..database.repository import SettingsRepository


def get_db() -> Session:
    yield from get_session()


def get_settings_repo(db: Session = Depends(get_db)) -> SettingsRepository:
    return SettingsRepository(db)
