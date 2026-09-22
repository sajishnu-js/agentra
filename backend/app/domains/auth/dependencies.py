"""FastAPI dependencies for reading the current session and gating routes.

Three layers, from loosest to tightest:
  - `get_current_user` — must be *someone*, real or implicit (see below).
  - `require_staff` — must be super_admin or admin (baseline access to the
    Settings / Agents / Knowledge Base areas — "can you be in here at all").
  - `require_permission("x")` — must have the specific permission, per
    auth/permissions.py (a super_admin always has it; an admin only if a
    super_admin granted it).
  - `require_super_admin` — must be super_admin specifically (the handful of
    things no admin can ever be granted — see SUPER_ADMIN_ONLY).

Every denial from the three gated dependencies is written to the audit log
via a standalone DB session (`audit.service.record_denied_access`) — not the
request's own session, which `get_db` rolls back the moment the
HTTPException it's about to raise propagates out of it.
"""

from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.audit.service import record_denied_access
from app.domains.auth.models import Session as SessionRow
from app.domains.auth.permissions import permissions_for
from app.domains.settings.models import get_or_create_workspace_settings
from app.domains.users.models import User, UserRole


async def _implicit_user(db: AsyncSession) -> User | None:
    """Who you are when Login Requirement is off and you showed up with no
    session — the highest-privilege active account, so "enter the workspace
    directly" means what it says (full access, no gate), not a confusing
    half-signed-in state. Falls back to *some* active user rather than none,
    so audit attribution and assignment features still have someone real."""
    priority = case(
        (User.role == UserRole.super_admin, 0),
        (User.role == UserRole.admin, 1),
        else_=2,
    )
    result = await db.execute(
        select(User).where(User.is_active.is_(True)).order_by(priority, User.created_at).limit(1)
    )
    return result.scalar_one_or_none()


async def _user_from_token(db: AsyncSession, token: str, workspace, request: Request) -> User | None:
    result = await db.execute(select(SessionRow).where(SessionRow.token == token))
    session_row = result.scalar_one_or_none()
    if session_row is None:
        return None

    idle_limit = timedelta(minutes=workspace.session_idle_timeout_minutes)
    now = datetime.now(UTC)
    if now - session_row.last_seen_at.astimezone(UTC) > idle_limit:
        await db.delete(session_row)
        await db.flush()
        return None

    if workspace.ip_allowlist:
        # Loopback is always trusted regardless of the list: a misconfigured
        # allowlist must never be able to lock out the machine Agentra itself
        # runs on.
        allowed = {ip.strip() for ip in workspace.ip_allowlist.split(",") if ip.strip()}
        client_ip = request.client.host if request.client else None
        if client_ip not in allowed and client_ip not in {"127.0.0.1", "::1"}:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your network address is not on the workspace allowlist",
            )

    session_row.last_seen_at = now
    await db.flush()
    user = await db.get(User, session_row.user_id)
    if user is None or not user.is_active:
        return None
    return user


async def get_current_session(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> SessionRow | None:
    """The raw session row behind the bearer token, or None.

    Distinct from `get_current_user`: session management (list/revoke
    devices) is inherently about *explicit* sessions, so it has no implicit-
    identity fallback — running with Login Requirement off and no token
    means there is nothing to list or revoke, not an implicit one. Callers
    (auth/router.py) handle None explicitly rather than treating it as an
    error.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    workspace = await get_or_create_workspace_settings(db)
    result = await db.execute(select(SessionRow).where(SessionRow.token == token))
    session_row = result.scalar_one_or_none()
    if session_row is None:
        return None

    idle_limit = timedelta(minutes=workspace.session_idle_timeout_minutes)
    now = datetime.now(UTC)
    if now - session_row.last_seen_at.astimezone(UTC) > idle_limit:
        return None

    session_row.last_seen_at = now
    await db.flush()
    return session_row


async def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    workspace = await get_or_create_workspace_settings(db)

    token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip() or None

    if token:
        # An explicit session always wins over the implicit fallback,
        # regardless of the login requirement, so someone who *did* sign in
        # is identified as themselves rather than the implicit identity.
        user = await _user_from_token(db, token, workspace, request)
        if user is not None:
            return user
        if workspace.require_login:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — sign in again")
        # Login isn't required, so a stale/invalid token falls through to
        # the implicit identity below rather than hard-blocking access.

    if workspace.require_login:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")

    implicit = await _implicit_user(db)
    if implicit is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "No active workspace account exists yet"
        )
    return implicit


def _dependency_wrapper(
    check: Callable[[User], bool], action: str, on_deny_detail: str
) -> Callable[[User], Coroutine[Any, Any, User]]:
    async def _dep(user: User = Depends(get_current_user)) -> User:
        if not check(user):
            await record_denied_access(actor=user, action=action, detail=on_deny_detail)
            raise HTTPException(status.HTTP_403_FORBIDDEN, on_deny_detail)
        return user

    return _dep


require_staff = _dependency_wrapper(
    lambda user: user.role in (UserRole.super_admin, UserRole.admin),
    action="access_denied",
    on_deny_detail="Settings, Agents and Knowledge Base are admin-only",
)

require_super_admin = _dependency_wrapper(
    lambda user: user.role == UserRole.super_admin,
    action="access_denied",
    on_deny_detail="Super Admins only",
)


def require_permission(permission: str):
    return _dependency_wrapper(
        lambda user: permission in permissions_for(user),
        action="access_denied",
        on_deny_detail=f"You don't have the '{permission}' permission",
    )
