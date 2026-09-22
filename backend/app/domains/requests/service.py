"""Creating requests from extracted classifications.

Owned by the requests domain rather than the orchestrator: the orchestrator's
job is to run the pipeline, not to know what makes two requests duplicates.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.requests.models import (
    Request,
    RequestCategory,
    RequestPriority,
    RequestStatus,
)
from app.llm.base import ExtractedRequest

log = logging.getLogger(__name__)

#: Categories that describe the same underlying job, for deduplication.
#: A customer who asks to move an order and then asks to cancel it has
#: not created two pieces of work — a member of staff opens the thread once and
#: deals with whatever it now says.
_EQUIVALENT: tuple[frozenset[RequestCategory], ...] = (
    frozenset({RequestCategory.order, RequestCategory.reschedule,
               RequestCategory.cancellation}),
    frozenset({RequestCategory.human_request, RequestCategory.callback}),
)


def _similar_categories(category: RequestCategory) -> set[RequestCategory]:
    """The category plus anything treated as the same work."""
    for group in _EQUIVALENT:
        if category in group:
            return set(group)
    return {category}


def coerce_category(value: str) -> RequestCategory:
    """Map a model-supplied string onto the taxonomy.

    Anything unrecognised becomes `other` rather than raising: a model
    inventing a category should produce a slightly mislabelled row for a human
    to fix, not a failed conversation turn.
    """
    try:
        return RequestCategory(value.strip().lower())
    except ValueError:
        log.warning("unknown request category %r from model, using 'other'", value)
        return RequestCategory.other


def coerce_priority(value: str) -> RequestPriority:
    """Map a model-supplied priority onto the taxonomy, defaulting to normal."""
    try:
        return RequestPriority(value.strip().lower())
    except ValueError:
        log.warning("unknown priority %r from model, using 'normal'", value)
        return RequestPriority.normal


async def find_open_duplicate(
    session: AsyncSession, conversation_id: UUID, category: RequestCategory
) -> Request | None:
    """An existing unresolved request on this thread for equivalent work."""
    result = await session.execute(
        select(Request)
        .where(
            Request.conversation_id == conversation_id,
            Request.status == RequestStatus.pending,
            Request.category.in_(_similar_categories(category)),
        )
        .order_by(Request.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_from_extraction(
    session: AsyncSession,
    conversation_id: UUID,
    extracted: ExtractedRequest,
) -> tuple[Request | None, str]:
    """Store an extracted request, unless one is already open for it.

    Returns (request, outcome) where outcome is "created", "duplicate" or
    "escalated". The caller logs it; nothing here commits.
    """
    category = coerce_category(extracted.category)
    priority = coerce_priority(extracted.priority)

    existing = await find_open_duplicate(session, conversation_id, category)
    if existing is not None:
        # One case where a duplicate still matters: the new message is more
        # urgent than the open request. Raising the priority is more useful
        # than either ignoring it or creating a second row.
        order = list(RequestPriority)
        if order.index(priority) > order.index(existing.priority):
            log.info(
                "raising request %s priority %s -> %s",
                existing.id,
                existing.priority.value,
                priority.value,
            )
            existing.priority = priority
            return existing, "escalated"

        log.info(
            "request already open on conversation %s for %s, skipping",
            conversation_id,
            category.value,
        )
        return existing, "duplicate"

    request = Request(
        conversation_id=conversation_id,
        category=category,
        priority=priority,
        # Trim rather than reject: title is String(300) and a model that
        # ignores the length guidance should not cost a request row.
        title=extracted.title[:300],
        status=RequestStatus.pending,
        created_at=datetime.now(UTC),
    )
    session.add(request)
    return request, "created"
