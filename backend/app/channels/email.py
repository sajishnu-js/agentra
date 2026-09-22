"""Email — outbound via SMTP, inbound via a webhook.

Sending is real SMTP (aiosmtplib), no different in kind from what any mail
client does. Receiving is deliberately *not* an IMAP poller or a mail server
of our own — both are substantial infrastructure in their own right, well
beyond one adapter class — so inbound mail is expected to arrive as a
provider's inbound-parse webhook (SendGrid, Postmark and Mailgun all offer
one: the provider receives the mail on our behalf and POSTs the parsed
fields to a URL we register).

`normalize()` expects that POST already reduced to this deployment's own
minimal shape — `{"from_address", "from_name", "message_id", "text"}` — via
app/webhooks/router.py. Switching providers means adjusting the parsing in
that one webhook route, not this file.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path
from typing import Any

import aiosmtplib

from app.channels.base import ChannelAdapter, InternalMessage
from app.core.config import settings
from app.domains.contacts.models import Channel

log = logging.getLogger(__name__)


class EmailNotConfigured(RuntimeError):
    pass


class EmailAdapter(ChannelAdapter):
    channel = Channel.email

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        username: str | None = None,
        password: str | None = None,
        from_address: str | None = None,
    ) -> None:
        self._host = host or settings.smtp_host
        self._port = port or settings.smtp_port
        self._username = username or settings.smtp_username
        self._password = password or settings.smtp_password
        self._from_address = from_address or settings.smtp_from_address
        if not self._host or not self._from_address:
            raise EmailNotConfigured(
                "SMTP_HOST and SMTP_FROM_ADDRESS are not both set. Put your SMTP "
                "server's host, credentials and a From address in backend/.env."
            )

    def normalize(self, event: Any) -> InternalMessage | None:
        if not isinstance(event, dict):
            return None

        from_address = event.get("from_address")
        message_id = event.get("message_id")
        text = event.get("text")
        if not from_address or not message_id or not text or not text.strip():
            return None

        return InternalMessage(
            channel=self.channel,
            external_contact_id=from_address,
            external_message_id=message_id,
            text=text.strip(),
            reply_to=from_address,
            sender_name=event.get("from_name"),
        )

    async def send(self, reply_to: str, text: str) -> str:
        """Send a reply. Returns this message's own Message-ID header, since
        SMTP (unlike the Graph API or Telegram's Bot API) has no server-
        assigned id to hand back — the sender mints one instead."""
        message_id = make_msgid()
        message = EmailMessage()
        message["From"] = self._from_address
        message["To"] = reply_to
        message["Subject"] = "Re: your message"
        message["Message-ID"] = message_id
        message.set_content(text)

        await aiosmtplib.send(
            message,
            hostname=self._host,
            port=self._port,
            username=self._username or None,
            password=self._password or None,
            start_tls=settings.smtp_use_tls,
        )
        return message_id

    async def test_connection(self) -> None:
        """Connect and authenticate without sending anything — confirms the
        server is reachable and the credentials work."""
        client = aiosmtplib.SMTP(
            hostname=self._host, port=self._port, start_tls=settings.smtp_use_tls
        )
        await client.connect()
        try:
            if self._username and self._password:
                await client.login(self._username, self._password)
        finally:
            await client.quit()

    async def send_attachment(
        self,
        *,
        reply_to: str,
        file_path: Path,
        filename: str,
        content_type: str,
        caption: str | None = None,
    ) -> str:
        """A real MIME attachment — email is the one channel here where
        "attach a file" and "send a message" have always been the same
        protocol feature, no separate upload step involved."""
        message_id = make_msgid()
        message = EmailMessage()
        message["From"] = self._from_address
        message["To"] = reply_to
        message["Subject"] = "Re: your message"
        message["Message-ID"] = message_id
        message.set_content(caption or "Please see the attached file.")

        maintype, _, subtype = content_type.partition("/")
        message.add_attachment(
            file_path.read_bytes(),
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=filename,
        )

        await aiosmtplib.send(
            message,
            hostname=self._host,
            port=self._port,
            username=self._username or None,
            password=self._password or None,
            start_tls=settings.smtp_use_tls,
        )
        return message_id
