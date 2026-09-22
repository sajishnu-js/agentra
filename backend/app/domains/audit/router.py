from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.audit.models import AuditLog
from app.domains.audit.schemas import AuditLogPage

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogPage)
async def list_audit_logs(
    entity_type: str | None = None,
    action: str | None = None,
    actor_user_id: UUID | None = None,
    q: str | None = Query(default=None, description="Search within the summary text"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Newest first, filtered and paginated.

    Filters are built once and applied to both the page query and the count
    query, so `total` always describes the same filtered set the page is
    drawn from rather than the table as a whole.
    """
    filters = []
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if action:
        filters.append(AuditLog.action == action)
    if actor_user_id:
        filters.append(AuditLog.actor_user_id == actor_user_id)
    if q:
        filters.append(AuditLog.summary.ilike(f"%{q}%"))

    base = select(AuditLog).where(*filters)
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    result = await db.execute(base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))
    return {"items": list(result.scalars()), "total": total or 0}


@router.delete("", status_code=204)
async def purge_audit_logs(
    older_than_days: int = Query(ge=1), db: AsyncSession = Depends(get_db)
) -> None:
    """Manual retention purge — see settings.audit_log_retention_days, which
    the Security settings screen reads to suggest a cutoff. Deliberately a
    button-triggered action rather than an automatic scheduled job: this
    codebase's only background worker is the RQ message pipeline
    (app/jobs/), and bolting periodic maintenance onto it is a separate
    concern from what this task asked for.
    """
    cutoff = datetime.now(UTC) - timedelta(days=older_than_days)
    await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    await db.flush()
