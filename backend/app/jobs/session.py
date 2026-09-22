"""Database sessions for queue workers.

The API's engine in app.core.database is created once at import and pools
connections. That is right for a long-lived server and wrong for an RQ worker,
because an RQ job is a synchronous function: the natural way to call async code
from one is asyncio.run(), and that creates and destroys an event loop per job.
asyncpg connections are bound to the loop that opened them, so a pooled
connection from a previous job belongs to a loop that no longer exists, and the
second job fails in a way that looks like a driver bug.

So a worker gets its own engine per job, with NullPool, and disposes it. The
cost is one connection setup per message, which is nothing next to an embedding
pass and an LLM call.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


@asynccontextmanager
async def worker_session() -> AsyncGenerator:
    """One engine, one session, torn down on exit."""
    engine = create_async_engine(
        settings.database_url,
        echo=settings.db_echo,
        poolclass=NullPool,
    )
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()
