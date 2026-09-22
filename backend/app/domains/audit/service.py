"""One call site per mutation worth remembering.

Import and await directly — no event bus. This is a modular monolith and
every caller already has the request's session open, so there is nothing an
indirection would buy beyond another place for the write to silently not
happen.
"""

import enum
from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal
from app.domains.audit.models import AuditLog
from app.domains.users.models import User


def _json_safe(value: Any) -> Any:
    """Recursively coerce values a caller might reasonably pass in `context`
    (UUIDs, enums, datetimes) into what Postgres's JSONB column can actually
    store, so no call site has to remember to do this itself."""
    if isinstance(value, (UUID, enum.Enum)):
        return str(value.value) if isinstance(value, enum.Enum) else str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


async def record_audit(
    db: AsyncSession,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
    summary: str,
    context: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id if actor else None,
            actor_name=actor.name if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            context=_json_safe(context) if context is not None else None,
        )
    )
    await db.flush()


async def record_denied_access(*, actor: User, action: str, detail: str) -> None:
    """For permission denials specifically — a 403 raised from inside a
    FastAPI dependency propagates out through `get_db`'s generator, which
    rolls back the request's own session (see core/database.get_db). A row
    added there would never survive to be read back, so this opens its own
    independent session/transaction and commits immediately instead of
    reusing the request's (doomed) one.
    """
    async with SessionLocal() as session:
        session.add(
            AuditLog(
                actor_user_id=actor.id,
                actor_name=actor.name,
                action=action,
                entity_type="access",
                entity_id=None,
                summary=f"{actor.name} was denied: {detail}",
            )
        )
        await session.commit()
