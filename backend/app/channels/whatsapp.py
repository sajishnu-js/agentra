"""WhatsApp, via the Meta WhatsApp Cloud API.

A webhook, not long polling: unlike Telegram's Bot API, Meta requires a
publicly reachable HTTPS URL registered in the developer console, which
verifies it with a GET handshake before any inbound message ever arrives (see
app/webhooks/router.py). There is no official Python SDK for the Cloud API —
it is a plain Graph API REST surface — so this speaks to it directly over
httpx rather than wrapping a client library.
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


class WhatsAppNotConfigured(RuntimeError):
    pass


class WhatsAppAdapter(ChannelAdapter):
    channel = Channel.whatsapp

    def __init__(
        self, access_token: str | None = None, phone_number_id: str | None = None
    ) -> None:
        self._token = access_token or settings.whatsapp_access_token
        self._phone_number_id = phone_number_id or settings.whatsapp_phone_number_id
        if not self._token or not self._phone_number_id:
            raise WhatsAppNotConfigured(
                "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not both set. "
                "Create a WhatsApp app at developers.facebook.com, add the WhatsApp "
                "product, and put its access token and phone number id in backend/.env."
            )

    def normalize(self, event: Any) -> InternalMessage | None:
        """Turn one Cloud API webhook payload (already-parsed JSON) into an
        InternalMessage.

        Ignores anything that is not an inbound text message — delivery/read
        status callbacks, reactions, non-text media. Those are real webhook
        deliveries, just not ones this pipeline has anything to say about yet.
        Shaped defensively (.get() throughout): a malformed or unexpected
        payload should be treated as "not for us", never a 500 back to Meta.
        """
        if not isinstance(event, dict):
            return None

        try:
            change = event["entry"][0]["changes"][0]["value"]
        except (KeyError, IndexError, TypeError):
            return None

        messages = change.get("messages") or []
        if not messages:
            return None
        message = messages[0]

        if message.get("type") != "text":
            return None
        body = (message.get("text") or {}).get("body")
        if not body or not body.strip():
            return None

        sender_id = message.get("from")
        message_id = message.get("id")
        if not sender_id or not message_id:
            return None

        contacts = change.get("contacts") or []
        profile_name = None
        if contacts:
            profile_name = (contacts[0].get("profile") or {}).get("name")

        return InternalMessage(
            channel=self.channel,
            external_contact_id=sender_id,
            external_message_id=message_id,
            text=body.strip(),
            # WhatsApp has no separate "chat id" the way Telegram groups do —
            # the sender's own number is always where a reply goes.
            reply_to=sender_id,
            sender_name=profile_name,
        )

    async def send(self, reply_to: str, text: str) -> str:
        """Send a reply. Returns the Cloud API's id for the sent message."""
        url = f"{GRAPH_API_BASE}/{self._phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": reply_to,
            "type": "text",
            "text": {"body": text},
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {self._token}"},
            )
        if response.is_error:
            raise RuntimeError(
                f"WhatsApp send failed ({response.status_code}): {response.text}"
            )
        data = response.json()
        return data["messages"][0]["id"]

    async def test_connection(self) -> None:
        """A plain read of the sending number itself — confirms the token is
        valid and actually scoped to this phone_number_id, without sending
        anything."""
        url = f"{GRAPH_API_BASE}/{self._phone_number_id}"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                url,
                params={"fields": "display_phone_number"},
                headers={"Authorization": f"Bearer {self._token}"},
            )
        if response.is_error:
            raise RuntimeError(
                f"WhatsApp connection check failed ({response.status_code}): {response.text}"
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
        """Two Graph API calls: upload the file to get a media id, then send
        a message referencing that id — the Cloud API's real media flow."""
        headers = {"Authorization": f"Bearer {self._token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            with file_path.open("rb") as handle:
                upload = await client.post(
                    f"{GRAPH_API_BASE}/{self._phone_number_id}/media",
                    data={"messaging_product": "whatsapp"},
                    files={"file": (filename, handle, content_type)},
                    headers=headers,
                )
            if upload.is_error:
                raise RuntimeError(
                    f"WhatsApp media upload failed ({upload.status_code}): {upload.text}"
                )
            media_id = upload.json()["id"]

            media_kind = "image" if content_type.startswith("image/") else "document"
            media_payload: dict[str, str] = {"id": media_id}
            if caption:
                media_payload["caption"] = caption
            if media_kind == "document":
                media_payload["filename"] = filename

            response = await client.post(
                f"{GRAPH_API_BASE}/{self._phone_number_id}/messages",
                json={
                    "messaging_product": "whatsapp",
                    "to": reply_to,
                    "type": media_kind,
                    media_kind: media_payload,
                },
                headers=headers,
            )
        if response.is_error:
            raise RuntimeError(
                f"WhatsApp send failed ({response.status_code}): {response.text}"
            )
        return response.json()["messages"][0]["id"]
