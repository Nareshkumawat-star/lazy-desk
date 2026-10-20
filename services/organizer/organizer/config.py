"""Runtime configuration for the local LazyDesk service."""

from __future__ import annotations

import os
import secrets
import sys
from functools import lru_cache
from pathlib import Path

APP_NAME = "LazyDesk"
APP_VERSION = "0.1.0"
HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def default_data_dir() -> Path:
    """Return the per-user application data directory."""
    override = os.environ.get("LAZYDESK_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "LazyDesk"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LazyDesk"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "lazydesk"


class AppConfig:
    def __init__(self) -> None:
        self.data_dir = default_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "lazydesk.db"
        self.token_file = self.data_dir / "service-token"
        self.host = os.environ.get("LAZYDESK_HOST", HOST)
        self.port = int(os.environ.get("LAZYDESK_PORT", DEFAULT_PORT))
        self.log_level = os.environ.get("LAZYDESK_LOG_LEVEL", "info")
        self.service_token = self._load_token()
        self.allowed_origins = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8765",
            "http://127.0.0.1:8765",
            "lazydesk://app",
        ]

    def _load_token(self) -> str:
        """Load or generate the loopback service token.

        The token is stored next to the database with owner-only permissions so the
        Electron shell can hand it to the renderer without any network exposure.
        """
        env_token = os.environ.get("LAZYDESK_SERVICE_TOKEN")
        if env_token:
            return env_token
        try:
            if self.token_file.exists():
                existing = self.token_file.read_text(encoding="utf-8").strip()
                if len(existing) >= 16:
                    return existing
        except OSError:
            pass
        token = secrets.token_urlsafe(32)
        try:
            self.token_file.write_text(token, encoding="utf-8")
            if sys.platform != "win32":
                self.token_file.chmod(0o600)
        except OSError:
            pass
        return token


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    return AppConfig()
