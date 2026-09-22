"""One call site per real event worth telling someone about.

Mirrors audit/service.py's own reasoning: import and await directly, no
event bus — every caller already has the request's (or job's) session open.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.notifications.models import Notification


async def notify(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> Notification:
    notification = Notification(user_id=user_id, title=title, body=body, link=link)
    db.add(notification)
    await db.flush()
    return notification
