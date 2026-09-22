"""Redis connection and the RQ queue.

Named `jobs` rather than `queue` so it cannot be confused with the standard
library module of that name.
"""

from __future__ import annotations

from functools import lru_cache

from redis import Redis
from rq import Queue

from app.core.config import settings


@lru_cache(maxsize=1)
def get_redis() -> Redis:
    """A synchronous Redis client, which is what RQ speaks.

    Separate from app.core.redis, which is the async client the API uses for
    its health check. Same server, different driver.
    """
    return Redis.from_url(settings.redis_url)


@lru_cache(maxsize=1)
def get_queue() -> Queue:
    return Queue(
        settings.rq_queue_name,
        connection=get_redis(),
        default_timeout=settings.rq_job_timeout,
    )
