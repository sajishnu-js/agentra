"""Telegram long-polling listener.

    python -m app.telegram_bot

Does the minimum and nothing else: normalize the update, put a job on the
queue, return. No database, no embedding, no LLM call — all of that belongs to
the worker, so that a slow model or a Postgres hiccup can never make the bot
stop reading its inbox.

Long polling needs no public URL and no TLS. WhatsApp will need a real webhook;
the adapter interface is what keeps that from reaching the orchestrator.
"""

from __future__ import annotations

import logging

from rq import Retry
from telegram import Update
from telegram.ext import Application, MessageHandler, filters

from app.channels.telegram import TelegramAdapter, TelegramNotConfigured
from app.core.config import settings
from app.jobs.connection import get_queue
from app.jobs.tasks import handle_inbound_message

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-5s %(name)s: %(message)s"
)
# PTB's HTTP layer logs every getUpdates poll at INFO. Useful once, noise after.
logging.getLogger("httpx").setLevel(logging.WARNING)

log = logging.getLogger("agentra.telegram")


async def on_message(update: Update, _context) -> None:
    adapter: TelegramAdapter = _context.application.bot_data["adapter"]

    message = adapter.normalize(update)
    if message is None:
        return

    job = get_queue().enqueue(
        handle_inbound_message,
        message.as_job_payload(),
        job_timeout=settings.rq_job_timeout,
        # Gemini returns a transient 503 under load, and that should not cost a
        # customer their answer. Safe to retry because the orchestrator only
        # treats a message as done once a reply exists — see process_inbound.
        retry=Retry(max=3, interval=[10, 30, 90]),
    )
    log.info(
        "queued %s from %s as job %s",
        message.external_message_id,
        message.sender_name or message.external_contact_id,
        job.id,
    )


def main() -> int:
    try:
        adapter = TelegramAdapter()
    except TelegramNotConfigured as error:
        log.error("%s", error)
        return 1

    # Fail here rather than on the first message.
    queue = get_queue()
    try:
        queue.connection.ping()
    except Exception as error:  # noqa: BLE001
        log.error("cannot reach Redis at %s: %s", settings.redis_url, error)
        return 1

    application = Application.builder().token(adapter._token).build()
    application.bot_data["adapter"] = adapter
    # Text and captioned media; normalize() decides what is actually usable.
    application.add_handler(
        MessageHandler(filters.TEXT | filters.CAPTION, on_message)
    )

    log.info("polling Telegram, queueing to %r", settings.rq_queue_name)
    application.run_polling(allowed_updates=["message"], drop_pending_updates=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
