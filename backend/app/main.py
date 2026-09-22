"""Agentra API — a modular monolith.

Run locally:  uvicorn app.main:app --reload
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.redis import close_redis, get_redis
from app.core.storage import UPLOAD_ROOT
from app.domains.workflows.scheduler import run_scheduler
from app.webhooks.router import router as webhooks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Workflow delays, schedules and retries. In-process rather than a second
    # worker — see app/domains/workflows/scheduler.py for why, including how
    # it stays correct if this ever runs with more than one uvicorn worker.
    scheduler = asyncio.create_task(run_scheduler())
    yield
    scheduler.cancel()
    try:
        await scheduler
    except asyncio.CancelledError:
        pass
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title=f"{settings.project_name} API",
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)
# Not under api_prefix/api_router: these are called by Meta or an email
# provider, not the frontend, and authenticate themselves rather than via an
# Agentra session (see app/webhooks/router.py's module docstring).
app.include_router(webhooks_router)

UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Liveness only — does not touch Postgres or Redis."""
    return {"status": "ok", "environment": settings.environment}


@app.get("/health/ready", tags=["meta"])
async def readiness() -> dict[str, object]:
    """Verifies Postgres (with pgvector) and Redis are actually reachable."""
    checks: dict[str, object] = {}

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            result = await conn.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            )
            version = result.scalar_one_or_none()
        checks["postgres"] = "ok"
        checks["pgvector"] = version or "missing"
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller
        checks["postgres"] = f"error: {exc}"

    try:
        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {exc}"

    healthy = all(v == "ok" for k, v in checks.items() if k != "pgvector")
    return {"status": "ok" if healthy else "degraded", "checks": checks}
