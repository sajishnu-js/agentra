"""The channel abstraction.

A channel adapter is the only thing in the system that knows what Telegram or
WhatsApp look like on the wire. Everything downstream — the queue, the
orchestrator, the database — works in terms of InternalMessage, so adding
WhatsAppAdapter later means writing one class and registering it, with no edit
to the orchestrator.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.domains.contacts.models import Channel


@dataclass
class InternalMessage:
    """A channel-agnostic inbound message.

    `external_contact_id` is whatever the channel calls the sender — a Telegram
    user id, later a WhatsApp phone number. It is the key used to find or
    create the Contact, so it has to be stable per person per channel.

    `external_message_id` is the channel's own id for this message. It is
    carried so the orchestrator can recognise a message it has already handled;
    a queue that retries is a queue that will eventually deliver twice.
    """

    channel: Channel
    external_contact_id: str
    external_message_id: str
    text: str | None
    # Where a reply should go. Same as the contact id on Telegram private
    # chats, but not on every channel, so it is kept separate.
    reply_to: str
    sender_name: str | None = None
    # Anything channel-specific worth keeping for debugging. Never read by the
    # orchestrator.
    raw: dict[str, Any] = field(default_factory=dict)

    def as_job_payload(self) -> dict[str, Any]:
        """A plain dict, because this crosses a Redis queue boundary.

        RQ pickles arguments, but pickling a dataclass couples the queue to the
        exact class definition — a deploy mid-flight would fail to unpickle
        jobs enqueued by the previous version. A dict does not have that
        problem.
        """
        return {
            "channel": self.channel.value,
            "external_contact_id": self.external_contact_id,
            "external_message_id": self.external_message_id,
            "text": self.text,
            "reply_to": self.reply_to,
            "sender_name": self.sender_name,
        }

    @classmethod
    def from_job_payload(cls, payload: dict[str, Any]) -> InternalMessage:
        return cls(
            channel=Channel(payload["channel"]),
            external_contact_id=payload["external_contact_id"],
            external_message_id=payload["external_message_id"],
            text=payload.get("text"),
            reply_to=payload["reply_to"],
            sender_name=payload.get("sender_name"),
        )


class ChannelAdapter(ABC):
    """One implementation per messaging channel."""

    #: Which Channel enum member this adapter serves.
    channel: Channel

    @abstractmethod
    def normalize(self, event: Any) -> InternalMessage | None:
        """Turn a channel-native update into an InternalMessage.

        Returns None for anything not worth processing — a status callback, an
        edit, a message with no text. Returning None rather than raising keeps
        "this is not for us" separate from "this is broken".
        """

    @abstractmethod
    async def send(self, reply_to: str, text: str) -> str:
        """Deliver a reply. Returns the channel's id for the sent message."""

    async def test_connection(self) -> None:
        """Verify this adapter can actually reach its provider right now —
        the "Sync" button's real action (see inboxes/router.py). Raises on
        failure. The default is a no-op success: having constructed at all
        already proves credentials are *present* (see each adapter's own
        __init__), which is all a channel with nothing further to check can
        promise. Override where a real, cheap round trip exists (Telegram's
        getMe, a Graph API read, an SMTP handshake) so this button proves
        the credentials actually *work*, not just that they are set.
        """
        return None

    async def send_attachment(
        self,
        *,
        reply_to: str,
        file_path: Path,
        filename: str,
        content_type: str,
        caption: str | None = None,
    ) -> str:
        """Deliver a file. Returns the channel's id for the sent message.

        The default falls back to a plain-text message: the caption (if any)
        plus a public link to the file — the honest baseline for any channel
        with no native media API implemented. Raises if no public URL can be
        built (see app.core.storage.absolute_url) rather than ever handing a
        channel a relative /uploads/... path a customer's device cannot
        resolve. Override where the channel has a real upload/attach API
        (Telegram's send_document, the Graph API's media endpoints).
        """
        from app.core.storage import absolute_url

        url = absolute_url(file_path)
        if url is None:
            raise RuntimeError(
                f"{self.channel.value} has no native attachment upload here, and "
                "PUBLIC_BASE_URL is not set to fall back to a link — configure "
                "one or the other before sending a file on this channel."
            )
        text = f"{caption}\n\n{url}" if caption else url
        return await self.send(reply_to, text)

    async def edit(self, *, reply_to: str, external_id: str, new_text: str) -> None:
        """Edit a previously sent message on the channel itself, if the
        protocol supports it. Default: not supported. The caller (see
        conversations/router.py) treats this as "this channel has no such
        capability" and keeps the local edit — which always happens
        regardless — rather than as a failure to report."""
        raise NotImplementedError(f"{self.channel.value} has no message-edit API")

    async def delete(self, *, reply_to: str, external_id: str) -> None:
        """Delete a previously sent message on the channel itself, if the
        protocol supports it. Same default and same caller behaviour as
        edit() above."""
        raise NotImplementedError(f"{self.channel.value} has no message-delete API")
