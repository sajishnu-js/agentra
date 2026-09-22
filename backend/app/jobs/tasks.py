"""RQ job entry points.

These are the only functions RQ needs to import, and they are deliberately
thin: unwrap the payload, run the orchestrator, let exceptions escape so RQ
records a failure rather than swallowing it.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger(__name__)


def handle_inbound_message(payload: dict[str, Any]) -> dict[str, Any]:
    """Process one inbound message end to end.

    Synchronous because that is what RQ calls, with a fresh event loop per job.
    See app.jobs.session for why the worker does not reuse the API's engine.
    """
    # Imported inside the function so that enqueuing a job does not drag the
    # embedding model, the LLM SDK and the channel adapters into the web
    # process.
    from app.channels.base import InternalMessage
    from app.orchestrator import process_inbound

    message = InternalMessage.from_job_payload(payload)
    log.info(
        "handling %s message %s from %s",
        message.channel.value,
        message.external_message_id,
        message.external_contact_id,
    )
    return asyncio.run(process_inbound(message))
