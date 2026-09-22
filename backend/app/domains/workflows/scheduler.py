"""The background loop that drives delays, schedules and retries.

An asyncio task on the API process's own lifespan rather than a cron
dependency or a second worker process: this app is a single-node,
self-hosted deployment (see settings.upload_dir's rationale for the same
constraint), the API is already always running, and the work per tick is a
handful of indexed queries that usually match nothing.

The one thing that matters if this app is ever run with multiple uvicorn
workers: each would run its own loop, and two ticks could pick up the same
due execution. The advisory lock below makes that safe — only the process
holding it ticks, the rest no-op.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app.core.database import SessionLocal
from app.domains.workflows.engine import tick

log = logging.getLogger(__name__)

TICK_SECONDS = 30

#: An arbitrary but fixed key — pg_advisory_lock is keyed by integer, and
#: this one is only ever used here.
_LOCK_KEY = 7_240_119


async def _tick_once() -> None:
    """One guarded tick.

    The lock is a *transaction*-scoped advisory lock, not a session-scoped
    one. That distinction was a real bug: `pg_try_advisory_lock` is held by
    the PostgreSQL session (here, a pooled connection), and the matching
    `pg_advisory_unlock` used to run after `session.commit()` had already
    returned that connection to the pool — so the unlock executed on a
    *different* connection, released nothing, and the original connection
    went back into the pool still holding the lock. From then on a tick only
    ran when the pool happened to hand back that same connection (advisory
    locks are re-entrant per session), so delays, scheduled workflows and
    retries stalled intermittently and, once the pool grew, permanently.

    `pg_try_advisory_xact_lock` is released by Postgres when the transaction
    ends — commit or rollback, both handled by `session.begin()` below — so
    there is no unlock to misplace and no way to leak it.
    """
    try:
        async with SessionLocal() as session:
            async with session.begin():
                acquired = await session.scalar(
                    text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": _LOCK_KEY}
                )
                if not acquired:
                    return
                result = await tick(session)
            if any(result.values()):
                log.info("workflow tick: %s", result)
    except Exception:
        log.exception("workflow scheduler tick failed")


async def run_scheduler() -> None:
    """Loops until cancelled by the lifespan handler on shutdown."""
    log.info("workflow scheduler started (every %ss)", TICK_SECONDS)
    while True:
        try:
            await _tick_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            # A tick that blows up must not kill the loop — the next one may
            # well succeed (a transient database hiccup, say).
            log.exception("workflow scheduler iteration failed")
        await asyncio.sleep(TICK_SECONDS)
