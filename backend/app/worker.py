"""RQ worker.

    python -m app.worker

Picks jobs off the queue and runs the orchestrator: contact, conversation,
message log, embedding, retrieval, LLM call, reply. One job at a time — run
several processes if that is ever not enough.

The embedding model loads on the first job and stays resident, so the first
reply is slow and the rest are not.
"""

from __future__ import annotations

import logging

from rq import SimpleWorker

from app.core.config import settings
from app.jobs.connection import get_queue, get_redis

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-5s %(name)s: %(message)s"
)
log = logging.getLogger("agentra.worker")


def main() -> int:
    redis = get_redis()
    try:
        redis.ping()
    except Exception as error:  # noqa: BLE001
        log.error("cannot reach Redis at %s: %s", settings.redis_url, error)
        return 1

    queue = get_queue()

    # SimpleWorker rather than the default forking Worker: a fork per job would
    # reload the 2.2 GB embedding model every time. It also means a crashing
    # job takes the worker with it, which is the right trade here — this runs
    # under a process manager and a crash should be loud.
    worker = SimpleWorker([queue], connection=redis)

    log.info(
        "worker ready on %r (llm=%s, model=%s)",
        settings.rq_queue_name,
        settings.llm_provider,
        settings.gemini_model if settings.llm_provider == "gemini" else settings.llm_provider,
    )
    worker.work(with_scheduler=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
