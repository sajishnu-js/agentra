"""Inbound webhook endpoints for channels that push rather than get polled.

Mounted directly on the FastAPI app (see app/main.py), not under api_router:
every route in api_router requires a signed-in Agentra session
(app/api.py's `_signed_in` dependency), and these callers are Meta or an
email provider, not a browser with a session cookie. Each route
authenticates itself instead: Meta's verify-token handshake plus an
X-Hub-Signature-256 HMAC on every POST, or a shared secret for email.

Both checks are required, not "verified if configured" — a webhook URL is
public the moment it is registered, so accepting an unsigned POST as a real
customer message would let anyone on the internet inject fake conversations
into the pipeline (and spend real LLM tokens doing it). An adapter can be
configured to *send* without its signing secret set; this router refuses to
*receive* until that secret exists too.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response, status
from rq import Retry

from app.channels.base import InternalMessage
from app.channels.email import EmailAdapter, EmailNotConfigured
from app.channels.instagram import InstagramAdapter, InstagramNotConfigured
from app.channels.whatsapp import WhatsAppAdapter, WhatsAppNotConfigured
from app.core.config import settings
from app.jobs.connection import get_queue
from app.jobs.tasks import handle_inbound_message

log = logging.getLogger("agentra.webhooks")

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _enqueue(message: InternalMessage) -> None:
    job = get_queue().enqueue(
        handle_inbound_message,
        message.as_job_payload(),
        job_timeout=settings.rq_job_timeout,
        # Matches telegram_bot.py's retry policy — a transient Gemini 503
        # should not cost a customer their answer.
        retry=Retry(max=3, interval=[10, 30, 90]),
    )
    log.info(
        "queued %s from %s (%s) as job %s",
        message.external_message_id,
        message.sender_name or message.external_contact_id,
        message.channel.value,
        job.id,
    )


def _require_signature(body: bytes, signature_header: str | None, app_secret: str | None) -> None:
    """Meta signs every POST with X-Hub-Signature-256: sha256=<hmac>, keyed
    with the app secret. Fails closed: no app secret configured means no
    inbound message from this route is trusted, full stop."""
    if not app_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Webhook signature verification is not configured — set the app "
            "secret in backend/.env before Meta's webhook can be enabled.",
        )
    if not signature_header or not signature_header.startswith("sha256="):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing webhook signature")
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature")


def _verify_handshake(
    mode: str | None, token: str | None, challenge: str | None, expected: str | None
) -> Response:
    """Meta's GET verification, run once when the webhook URL is registered."""
    if not expected:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This channel is not configured")
    if mode == "subscribe" and token == expected and challenge is not None:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Verification token mismatch")


# --- WhatsApp -------------------------------------------------------------


@router.get("/whatsapp")
async def verify_whatsapp(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
) -> Response:
    return _verify_handshake(
        hub_mode, hub_verify_token, hub_challenge, settings.whatsapp_verify_token
    )


@router.post("/whatsapp", status_code=status.HTTP_200_OK)
async def receive_whatsapp(
    request: Request, x_hub_signature_256: str | None = Header(None)
) -> dict[str, bool]:
    try:
        adapter = WhatsAppAdapter()
    except WhatsAppNotConfigured as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    body = await request.body()
    _require_signature(body, x_hub_signature_256, settings.whatsapp_app_secret)

    message = adapter.normalize(await request.json())
    if message is not None:
        _enqueue(message)
    # Meta expects 200 regardless of whether this specific event produced a
    # message — anything else makes it retry the same delivery repeatedly.
    return {"ok": True}


# --- Instagram -------------------------------------------------------------


@router.get("/instagram")
async def verify_instagram(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
) -> Response:
    return _verify_handshake(
        hub_mode, hub_verify_token, hub_challenge, settings.instagram_verify_token
    )


@router.post("/instagram", status_code=status.HTTP_200_OK)
async def receive_instagram(
    request: Request, x_hub_signature_256: str | None = Header(None)
) -> dict[str, bool]:
    try:
        adapter = InstagramAdapter()
    except InstagramNotConfigured as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    body = await request.body()
    _require_signature(body, x_hub_signature_256, settings.instagram_app_secret)

    message = adapter.normalize(await request.json())
    if message is not None:
        _enqueue(message)
    return {"ok": True}


# --- Email -------------------------------------------------------------


@router.post("/workflow/{token}", status_code=status.HTTP_200_OK)
async def trigger_workflow(token: str, request: Request) -> dict[str, object]:
    """The `webhook` trigger's inbound URL.

    Authenticated by the token in the path, which is the workflow's own
    rotatable secret (see Workflow.webhook_token) — unlike the channel
    routes above, the caller here is whatever system an admin chose to point
    at this URL, with no signing convention of its own to verify against.
    A wrong token is a flat 404 rather than a 401: an unauthenticated caller
    should not be able to probe which workflow ids exist.
    """
    # Local imports, matching this module's own convention of keeping the
    # heavier domain graph out of the webhook path unless it is actually used.
    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.domains.workflows import engine
    from app.domains.workflows.models import Workflow, WorkflowStatus

    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {"body": payload}

    async with SessionLocal() as session:
        workflow = await session.scalar(select(Workflow).where(Workflow.webhook_token == token))
        if workflow is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        if workflow.status is not WorkflowStatus.active:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This workflow is not enabled."
            )

        nodes = engine.trigger_nodes(workflow.graph or {}, "webhook")
        if not nodes:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This workflow has no webhook trigger."
            )

        context = await engine.build_context(session, payload=payload)
        executions = [
            await engine.start_run(session, workflow, node, context) for node in nodes
        ]
        await session.commit()
        return {"ok": True, "executions": [str(execution.id) for execution in executions]}


@router.post("/email", status_code=status.HTTP_200_OK)
async def receive_email(
    request: Request, x_webhook_secret: str | None = Header(None)
) -> dict[str, bool]:
    try:
        adapter = EmailAdapter()
    except EmailNotConfigured as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    if not settings.email_webhook_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "EMAIL_WEBHOOK_SECRET is not set — configure it before pointing an "
            "inbound-parse webhook at this URL.",
        )
    if x_webhook_secret != settings.email_webhook_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook secret")

    message = adapter.normalize(await request.json())
    if message is not None:
        _enqueue(message)
    return {"ok": True}
