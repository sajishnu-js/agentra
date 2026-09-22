"""Telegram, via python-telegram-bot in long-polling mode.

Long polling, not a webhook: it needs no public URL and no TLS, which is the
whole reason it is the right first channel. WhatsApp will need a real webhook,
which is why the adapter interface hides the difference.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from telegram import Bot, Update

from app.channels.base import ChannelAdapter, InternalMessage
from app.core.config import settings
from app.domains.contacts.models import Channel

log = logging.getLogger(__name__)

# Telegram rejects messages over 4096 characters outright.
TELEGRAM_MAX_CHARS = 4096


class TelegramNotConfigured(RuntimeError):
    pass


class TelegramAdapter(ChannelAdapter):
    channel = Channel.telegram

    def __init__(self, token: str | None = None) -> None:
        self._token = token or settings.telegram_bot_token
        if not self._token:
            raise TelegramNotConfigured(
                "TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather in "
                "Telegram and put the token in backend/.env."
            )

    def normalize(self, event: Any) -> InternalMessage | None:
        """Turn a telegram.Update into an InternalMessage.

        Ignores anything without a text body — joins, photos without captions,
        edits, channel posts. Those are real Telegram events, just not ones
        this pipeline has anything to say about yet.
        """
        if not isinstance(event, Update):
            return None

        message = event.message
        if message is None or message.from_user is None:
            return None

        text = message.text or message.caption
        if not text or not text.strip():
            return None

        user = message.from_user
        name = " ".join(part for part in (user.first_name, user.last_name) if part)

        return InternalMessage(
            channel=self.channel,
            external_contact_id=str(user.id),
            external_message_id=str(message.message_id),
            text=text.strip(),
            # On a private chat this equals the user id, but on a group it does
            # not, so it is taken from the chat rather than assumed.
            reply_to=str(message.chat_id),
            sender_name=name or user.username,
            raw={"chat_type": message.chat.type},
        )

    async def send(self, reply_to: str, text: str) -> str:
        """Send a reply. Splits anything over Telegram's hard 4096-char limit."""
        parts = _split(text, TELEGRAM_MAX_CHARS)

        # A short-lived Bot per send. The worker handles a message every few
        # seconds at most, so a persistent connection buys nothing and a
        # long-lived client inside an RQ job is a lifecycle problem.
        async with Bot(self._token) as bot:
            last_id = ""
            for part in parts:
                sent = await bot.send_message(chat_id=reply_to, text=part)
                last_id = str(sent.message_id)
        return last_id

    async def test_connection(self) -> None:
        """getMe — the cheapest real call the Bot API offers, and exactly
        what confirms the token is valid and the bot reachable."""
        async with Bot(self._token) as bot:
            await bot.get_me()

    async def send_attachment(
        self,
        *,
        reply_to: str,
        file_path: Path,
        filename: str,
        content_type: str,
        caption: str | None = None,
    ) -> str:
        async with Bot(self._token) as bot:
            with file_path.open("rb") as handle:
                if content_type.startswith("image/"):
                    sent = await bot.send_photo(chat_id=reply_to, photo=handle, caption=caption)
                else:
                    sent = await bot.send_document(
                        chat_id=reply_to, document=handle, filename=filename, caption=caption
                    )
        return str(sent.message_id)

    async def edit(self, *, reply_to: str, external_id: str, new_text: str) -> None:
        async with Bot(self._token) as bot:
            await bot.edit_message_text(chat_id=reply_to, message_id=int(external_id), text=new_text)

    async def delete(self, *, reply_to: str, external_id: str) -> None:
        async with Bot(self._token) as bot:
            await bot.delete_message(chat_id=reply_to, message_id=int(external_id))


def _split(text: str, limit: int) -> list[str]:
    """Break text into <= limit chunks, preferring paragraph then line breaks."""
    if len(text) <= limit:
        return [text]

    parts: list[str] = []
    remaining = text
    while len(remaining) > limit:
        window = remaining[:limit]
        cut = window.rfind("\n\n")
        if cut < limit // 2:
            cut = window.rfind("\n")
        if cut < limit // 2:
            cut = window.rfind(" ")
        if cut <= 0:
            cut = limit
        parts.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        parts.append(remaining)
    return parts
