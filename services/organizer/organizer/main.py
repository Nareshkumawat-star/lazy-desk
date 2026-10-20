"""FastAPI application for the local LazyDesk service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import library, organize, system
from .config import get_config
from .core.automation import AutomationScheduler
from .database.db import init_db
from .security import require_token

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

scheduler = AutomationScheduler(interval_seconds=60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler.start()
    logger.info("LazyDesk service ready at http://%s:%s", get_config().host, get_config().port)
    try:
        yield
    finally:
        await scheduler.stop()


app = FastAPI(
    title="LazyDesk Local Service",
    version=__version__,
    description="Local-first AI file organizer. Binds to loopback only.",
    lifespan=lifespan,
)

config = get_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins,
    allow_origin_regex=r"^(http://(localhost|127\.0\.0\.1)(:\d+)?|lazydesk://app)$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.public_router, prefix="/api", tags=["system"])
app.include_router(system.router, prefix="/api", tags=["settings"], dependencies=[Depends(require_token)])
app.include_router(organize.router, prefix="/api", tags=["organize"], dependencies=[Depends(require_token)])
app.include_router(library.router, prefix="/api", tags=["library"], dependencies=[Depends(require_token)])
