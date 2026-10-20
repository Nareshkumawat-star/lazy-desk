"""Optional scheduled scans for saved organization rules.

Automation is opt-in and off by default. A rule can notify (create a pending
session for review) or, only when the user explicitly checks auto-apply, move
files automatically using the same safe apply pipeline as manual runs.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.db import session_scope
from ..database.models import AutomationRule, OrganizationSession
from ..database.repository import SettingsRepository
from ..schemas import AutomationRunResponse
from .operations import apply_operations
from .workflow import build_plan, scan_into_session

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def next_run_at(rule: AutomationRule) -> datetime | None:
    if not rule.enabled:
        return None
    last = _aware(rule.last_run_at)
    if last is None:
        return _now()
    return last + timedelta(minutes=rule.interval_minutes)


def run_rule(
    db: Session,
    rule: AutomationRule,
    settings: SettingsRepository,
    *,
    force: bool = False,
    allow_auto_apply: bool | None = None,
) -> AutomationRunResponse:
    if not rule.enabled and not force:
        return AutomationRunResponse(
            rule_id=rule.id, status="disabled", message="Rule is paused."
        )
    if not settings.get_bool("automation.enabled", False) and not force:
        return AutomationRunResponse(
            rule_id=rule.id,
            status="disabled",
            message="Scheduled automation is turned off in Settings.",
        )

    try:
        session, scan = scan_into_session(
            db,
            path=rule.root_path,
            source="automation",
        )
    except Exception as exc:
        rule.last_run_at = _now()
        rule.last_result = f"Scan failed: {str(exc)[:200]}"
        db.commit()
        return AutomationRunResponse(
            rule_id=rule.id, status="failed", message=rule.last_result
        )

    categories = None
    if rule.categories_json:
        try:
            parsed = json.loads(rule.categories_json)
            if isinstance(parsed, list) and parsed:
                categories = [str(item) for item in parsed]
        except ValueError:
            categories = None

    try:
        outcome = build_plan(
            db,
            session,
            settings,
            use_ai=settings.get_bool("ai.enabled", True),
            ai_scope=settings.get("ai.scope") or "ambiguous",
            categories=categories,
        )
    except Exception as exc:
        rule.last_run_at = _now()
        rule.last_result = f"Planning failed: {str(exc)[:200]}"
        db.commit()
        return AutomationRunResponse(
            rule_id=rule.id, session_id=session.id, status="failed", message=rule.last_result
        )

    auto_apply = rule.auto_apply if allow_auto_apply is None else allow_auto_apply
    applied = 0
    if auto_apply and outcome.items:
        _batch, applied, failed, skipped, _errors, _ops = apply_operations(
            db, session, resolve_conflicts=True
        )
        message = f"Scanned {len(scan.files)} files and moved {applied} automatically."
        if failed or skipped:
            message += f" {failed + skipped} were left in place for review."
        status = "applied"
    else:
        message = (
            f"Scanned {len(scan.files)} files and prepared {len(outcome.items)} moves for review."
        )
        status = "pending_review"

    rule.last_run_at = _now()
    rule.last_session_id = session.id
    rule.last_result = message
    db.commit()
    return AutomationRunResponse(
        rule_id=rule.id,
        session_id=session.id,
        status=status,
        planned=len(outcome.items),
        applied=applied,
        message=message,
    )


def run_due_rules() -> None:
    """Run one automation tick. Safe to call from the scheduler or a test."""
    with session_scope() as db:
        settings = SettingsRepository(db)
        if not settings.get_bool("automation.enabled", False):
            return
        rules = list(db.scalars(select(AutomationRule).where(AutomationRule.enabled.is_(True))).all())
        now = _now()
        for rule in rules:
            due = next_run_at(rule)
            if due is None or due > now:
                continue
            logger.info("Running automation rule %s (%s)", rule.id, rule.name)
            run_rule(db, rule, settings)


class AutomationScheduler:
    def __init__(self, interval_seconds: int = 60) -> None:
        self.interval_seconds = interval_seconds
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.to_thread(run_due_rules)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - background guard
                logger.warning("Automation tick failed: %s", exc)
            await asyncio.sleep(self.interval_seconds)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None


def pending_sessions(db: Session, limit: int = 5) -> list[OrganizationSession]:
    return list(
        db.scalars(
            select(OrganizationSession)
            .where(OrganizationSession.source == "automation")
            .where(OrganizationSession.status.in_(("planned", "partial")))
            .order_by(OrganizationSession.created_at.desc())
            .limit(limit)
        ).all()
    )
