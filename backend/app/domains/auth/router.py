"""Sign in as a workspace identity — no password (see models.py docstring)."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import get_current_session, get_current_user
from app.domains.auth.models import Session as SessionRow
from app.domains.auth.models import generate_token
from app.domains.auth.permissions import permissions_for
from app.domains.auth.schemas import LoginRequest, LoginResponse, MeResponse, SessionRead
from app.domains.users.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/sessions", response_model=LoginResponse)
async def sign_in(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    email = payload.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "No active workspace account with that email"
        )

    now = datetime.now(UTC)
    session_row = SessionRow(
        user_id=user.id,
        token=generate_token(),
        last_seen_at=now,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    db.add(session_row)
    await db.flush()
    await record_audit(
        db,
        actor=user,
        action="sign_in",
        entity_type="session",
        entity_id=session_row.id,
        summary=f"{user.name} signed in",
    )
    return {"token": session_row.token, "user": user, "permissions": permissions_for(user)}


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user),
    current_session: SessionRow | None = Depends(get_current_session),
) -> dict:
    return {
        "user": user,
        "permissions": permissions_for(user),
        # No real session behind this request — running on the implicit
        # identity because Login Requirement is off — see dependencies.py.
        "implicit": current_session is None,
    }


@router.get("/sessions", response_model=list[SessionRead])
async def list_sessions(
    user: User = Depends(get_current_user),
    current_session: SessionRow | None = Depends(get_current_session),
    db: AsyncSession = Depends(get_db),
) -> list[SessionRead]:
    """Every active session for the signed-in user — the "where you're
    signed in" list, not an admin view of everyone's sessions. Empty for an
    implicit identity (Login Requirement off, no explicit sign-in) — there
    is no device-level session to show."""
    result = await db.execute(
        select(SessionRow).where(SessionRow.user_id == user.id).order_by(SessionRow.last_seen_at.desc())
    )
    current_id = current_session.id if current_session else None
    return [
        SessionRead.model_validate(row).model_copy(update={"is_current": row.id == current_id})
        for row in result.scalars()
    ]


@router.delete("/sessions/current", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(
    current_session: SessionRow | None = Depends(get_current_session),
    db: AsyncSession = Depends(get_db),
) -> None:
    """A no-op, not an error, when there's no real session to end — signing
    out of an implicit identity means nothing (see get_current_session)."""
    if current_session is not None:
        await db.delete(current_session)
        await db.flush()


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Sign out one of your own other sessions/devices."""
    target = await db.get(SessionRow, session_id)
    if target is None or target.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    await db.delete(target)
    await db.flush()


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_other_sessions(
    user: User = Depends(get_current_user),
    current_session: SessionRow | None = Depends(get_current_session),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Sign out every device except the one making this request (all of
    them, if this request isn't itself an explicit session)."""
    filters = [SessionRow.user_id == user.id]
    if current_session is not None:
        filters.append(SessionRow.id != current_session.id)
    await db.execute(delete(SessionRow).where(*filters))
    await db.flush()
