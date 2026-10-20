"""Authentication for the loopback-only service."""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from .config import get_config


def require_token(
    x_lazydesk_token: str | None = Header(default=None, alias="X-LazyDesk-Token"),
    authorization: str | None = Header(default=None),
) -> None:
    """Validate the per-install random token.

    The server binds to 127.0.0.1, but a token protects against other local
    processes (and malicious web pages abusing a browser) calling sensitive
    endpoints.
    """
    expected = get_config().service_token
    supplied = x_lazydesk_token
    if not supplied and authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not supplied or not secrets.compare_digest(str(supplied), expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid LazyDesk service token.",
        )
