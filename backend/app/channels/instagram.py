"""Instagram DMs, via the Meta Instagram Messaging API.

Same Graph API family and webhook-verification handshake as WhatsApp (see
app/channels/whatsapp.py's module docstring) but scoped to the Instagram
professional account's linked Page rather than a phone number.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from app.channels.base import ChannelAdapter, InternalMessage
from app.core.config import settings
from app.domains.contacts.models import Channel

log = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"


class InstagramNotConfigured(RuntimeError):
    pass


class InstagramAdapter(ChannelAdapter):
    channel = Channel.instagram

    def __init__(self, access_token: str | None = None, page_id: str | None = None) -> None:
        self._token = access_token or settings.instagram_access_token
        self._page_id = page_id or settings.instagram_page_id
        if not self._token or not self._page_id:
            raise InstagramNotConfigured(
                "INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_PAGE_ID are not both set. "
                "Connect the Instagram Messaging product to a Page at "
                "developers.facebook.com and put its access token and Page id in "
                "backend/.env."
            )

    def normalize(self, event: Any) -> InternalMessage | None:
        """Turn one Messenger-platform webhook payload into an InternalMessage.

        Ignores anything without a text body — delivery receipts, "seen"
        events, story replies without text, echoes of our own outbound sends
        (`message.is_echo`). Those are real webhook deliveries, just not ones
        this pipeline has anything to say about yet.
        """
        if not isinstance(event, dict):
            return None

        try:
            messaging = event["entry"][0]["messaging"][0]
        except (KeyError, IndexError, TypeError):
            return None

        message = messaging.get("message") or {}
        if message.get("is_echo"):
            return None

        text = message.get("text")
        if not text or not text.strip():
            return None

        sender_id = (messaging.get("sender") or {}).get("id")
        message_id = message.get("mid")
        if not sender_id or not message_id:
            return None

        return InternalMessage(
            channel=self.channel,
            external_contact_id=sender_id,
            external_message_id=message_id,
            text=text.strip(),
            reply_to=sender_id,
        )

    async def send(self, reply_to: str, text: str) -> str:
        """Send a reply. Returns the API's id for the sent message."""
        url = f"{GRAPH_API_BASE}/{self._page_id}/messages"
        payload = {"recipient": {"id": reply_to}, "message": {"text": text}}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {self._token}"},
            )
        if response.is_error:
            raise RuntimeError(
                f"Instagram send failed ({response.status_code}): {response.text}"
            )
        return response.json()["message_id"]

    async def test_connection(self) -> None:
        """A plain read of the Page itself — confirms the token is valid and
        actually scoped to this page_id, without sending anything."""
        url = f"{GRAPH_API_BASE}/{self._page_id}"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                url,
                params={"fields": "id"},
                headers={"Authorization": f"Bearer {self._token}"},
            )
        if response.is_error:
            raise RuntimeError(
                f"Instagram connection check failed ({response.status_code}): {response.text}"
            )

    async def send_attachment(
        self,
        *,
        reply_to: str,
        file_path: Path,
        filename: str,
        content_type: str,
        caption: str | None = None,
    ) -> str:
        """The Send API's attachment message takes a public URL, not an
        upload — unlike WhatsApp's Cloud API, there is no media-upload
        endpoint here. A caption cannot travel in the same message as an
        attachment on this API, so it goes first as its own text message."""
        from app.core.storage import absolute_url

        url = absolute_url(file_path)
        if url is None:
            raise RuntimeError(
                "PUBLIC_BASE_URL is not set — Instagram's Send API requires a "
                "public URL for attachments, not an upload."
            )

        if caption:
            await self.send(reply_to, caption)

        attachment_type = "image" if content_type.startswith("image/") else "file"
        payload = {
            "recipient": {"id": reply_to},
            "message": {"attachment": {"type": attachment_type, "payload": {"url": url}}},
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{GRAPH_API_BASE}/{self._page_id}/messages",
                json=payload,
                headers={"Authorization": f"Bearer {self._token}"},
            )
        if response.is_error:
            raise RuntimeError(
                f"Instagram send failed ({response.status_code}): {response.text}"
            )
        return response.json()["message_id"]
