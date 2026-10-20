"""Run the service with ``python -m organizer``."""

from __future__ import annotations

import argparse

import uvicorn

from .config import get_config


def main() -> None:
    config = get_config()
    parser = argparse.ArgumentParser(description="LazyDesk local service")
    parser.add_argument("--host", default=config.host)
    parser.add_argument("--port", type=int, default=config.port)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("LazyDesk only binds to loopback for privacy.")

    uvicorn.run(
        "organizer.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=config.log_level,
    )


if __name__ == "__main__":
    main()
