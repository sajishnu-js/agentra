from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.storage import UploadTooLarge, delete_upload, path_from_url, public_url, save_upload
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import get_current_user, require_permission
from app.domains.auth.permissions import DEFAULT_ADMIN_PERMISSIONS, GRANTABLE_PERMISSIONS
from app.domains.conversations.assignment import agent_workloads
from app.domains.users.models import User, UserRole
from app.domains.users.schemas import (
    UserCreate,
    UserRead,
    UserUpdate,
    UserUpdateAdmin,
    UserWorkload,
)

# Generous for a profile photo without being the general 25 MB upload cap —
# see save_upload's own MAX_UPLOAD_BYTES, which still applies as the hard
# backstop during the streamed read itself.
AVATAR_MAX_BYTES = 5 * 1024 * 1024

router = APIRouter(prefix="/users", tags=["users"])


# Literal paths declared above param paths throughout this router (matching
# the standing convention in agents/router.py) — "/me" and "/assignable" must
# both be matched before "/{user_id}" gets a chance to swallow them.


def _require_super_admin_for_admin_tier(actor: User, *, touches_admin_tier: bool) -> None:
    """`manage_users` (grantable to a plain admin) only ever reaches
    agent-tier accounts. Anything that creates, edits, or removes an
    admin/super_admin, or changes what an admin is granted, is Super Admin
    only — regardless of what manage_users itself would otherwise allow.
    Checked inline here rather than as a route dependency because only the
    endpoint knows the *target*'s (or payload's) role at call time.
    """
    if touches_admin_tier and actor.role != UserRole.super_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only a Super Admin can manage admin or Super Admin accounts.",
        )


async def _assert_not_last_super_admin(db: AsyncSession, target: User) -> None:
    if target.role != UserRole.super_admin:
        return
    other_super_admins = await db.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.super_admin, User.is_active.is_(True), User.id != target.id
        )
    )
    if not other_super_admins:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is the last active Super Admin — promote someone else first.",
        )


@router.get("", response_model=list[UserRead])
async def list_users(
    _: User = Depends(require_permission("manage_users")), db: AsyncSession = Depends(get_db)
) -> list[User]:
    """The full staff list, including inactive accounts — the admin-only
    management view. Use /users/assignable for the picker every role can see."""
    result = await db.execute(select(User).order_by(User.name))
    return list(result.scalars())


@router.get("/assignable", response_model=list[UserWorkload])
async def list_assignable(
    _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Active staff and how many conversations and pending requests each is
    currently holding.

    Useful for handing a thread or a ticket to a colleague, and it exposes
    nothing but names and counts.
    """
    loads = await agent_workloads(db)
    by_id = {load.user_id: load for load in loads}

    result = await db.execute(
        select(User).where(User.id.in_(by_id.keys())).order_by(User.name)
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "avatar_url": row.avatar_url,
            "role": row.role,
            "open_conversations": by_id[row.id].open_conversations,
            "open_requests": by_id[row.id].open_requests,
        }
        for row in result.scalars()
    ]


@router.patch("/me", response_model=UserRead)
async def update_my_profile(
    payload: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Self-service profile edit — name, contact details, appearance. No
    role or activation switch here; see UserUpdateAdmin for that."""
    changes = payload.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = changes["email"].strip().lower()
    for field, value in changes.items():
        setattr(user, field, value)
    await db.flush()
    if changes:
        await record_audit(
            db,
            actor=user,
            action="update",
            entity_type="user",
            entity_id=user.id,
            summary=f"{user.name} updated their profile ({', '.join(sorted(changes))})",
            context=changes,
        )
    await db.refresh(user)
    return user


@router.post("/me/avatar", response_model=UserRead)
async def upload_my_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Replace your own profile photo with an uploaded image.

    The real counterpart to avatar_url on UserUpdate: that field still
    accepts a manually-typed remote URL for anyone who prefers one (a
    Gravatar link, an already-hosted image), this is the "just pick a file"
    path most people want.
    """
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{content_type or 'This file type'} is not an image."
        )

    try:
        saved_path, size = await save_upload(file, category="avatars")
    except UploadTooLarge as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    if size > AVATAR_MAX_BYTES:
        delete_upload(saved_path)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Image is too large — the limit for a profile photo is "
            f"{AVATAR_MAX_BYTES // (1024 * 1024)} MB.",
        )

    old_avatar_url = user.avatar_url
    user.avatar_url = public_url(saved_path)
    await db.flush()
    await record_audit(
        db,
        actor=user,
        action="update",
        entity_type="user",
        entity_id=user.id,
        summary=f"{user.name} updated their profile photo",
    )
    await db.refresh(user)

    # Only clean up the old file if it was one of ours — a manually-typed
    # external URL (or no avatar at all) is not ours to delete.
    if old_avatar_url and old_avatar_url.startswith("/uploads/"):
        delete_upload(path_from_url(old_avatar_url))

    return user


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    actor: User = Depends(require_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
) -> User:
    _require_super_admin_for_admin_tier(actor, touches_admin_tier=payload.role != UserRole.agent)

    email = payload.email.strip().lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{email} is already a workspace account"
        )

    if payload.role == UserRole.admin:
        granted = [p for p in payload.granted_permissions if p in GRANTABLE_PERMISSIONS] or list(
            DEFAULT_ADMIN_PERMISSIONS
        )
    else:
        granted = []

    new_user = User(
        name=payload.name,
        email=email,
        role=payload.role,
        job_title=payload.job_title,
        phone=payload.phone,
        avatar_url=payload.avatar_url,
        granted_permissions=granted,
    )
    db.add(new_user)
    await db.flush()
    await record_audit(
        db,
        actor=actor,
        action="create",
        entity_type="user",
        entity_id=new_user.id,
        summary=f"{actor.name} added {new_user.name} ({new_user.role.value})",
        context={"role": new_user.role, "granted_permissions": granted},
    )
    return new_user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: UUID,
    payload: UserUpdateAdmin,
    actor: User = Depends(require_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    changes = payload.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = changes["email"].strip().lower()

    touches_admin_tier = (
        target.role != UserRole.agent
        or changes.get("role", UserRole.agent) != UserRole.agent
        or "granted_permissions" in changes
    )
    _require_super_admin_for_admin_tier(actor, touches_admin_tier=touches_admin_tier)

    # A demotion or deactivation must never strand the workspace with zero
    # super admins able to undo it — check before applying, not after.
    demoting = "role" in changes and changes["role"] != UserRole.super_admin
    deactivating = changes.get("is_active") is False
    if demoting or deactivating:
        await _assert_not_last_super_admin(db, target)

    if "granted_permissions" in changes:
        changes["granted_permissions"] = [
            p for p in changes["granted_permissions"] if p in GRANTABLE_PERMISSIONS
        ]
    elif changes.get("role") == UserRole.admin and target.role != UserRole.admin:
        # Promoting to admin with no grants specified in the same request —
        # start from the default bundle rather than silently leaving
        # whatever granted_permissions this row happened to already have
        # (typically none, for someone who was previously an agent).
        changes["granted_permissions"] = list(DEFAULT_ADMIN_PERMISSIONS)

    for field, value in changes.items():
        setattr(target, field, value)
    await db.flush()
    if changes:
        await record_audit(
            db,
            actor=actor,
            action="update",
            entity_type="user",
            entity_id=target.id,
            summary=f"{actor.name} updated {target.name} ({', '.join(sorted(changes))})",
            context=changes,
        )
    await db.refresh(target)
    return target


@router.patch("/{user_id}/active", response_model=UserRead)
async def set_active(
    user_id: UUID,
    is_active: bool,
    actor: User = Depends(require_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Activate or deactivate a colleague."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    _require_super_admin_for_admin_tier(actor, touches_admin_tier=target.role != UserRole.agent)
    if not is_active:
        await _assert_not_last_super_admin(db, target)

    target.is_active = is_active
    await db.flush()
    await record_audit(
        db,
        actor=actor,
        action="deactivate" if not is_active else "activate",
        entity_type="user",
        entity_id=target.id,
        summary=f"{actor.name} {'deactivated' if not is_active else 'reactivated'} {target.name}",
    )
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    actor: User = Depends(require_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard delete. Conversation.assigned_agent_id, Request.assigned_agent_id
    and Agent.owner_user_id are all ON DELETE SET NULL, so this unassigns
    cleanly rather than blocking or cascading into work the person did.

    Invariants a delete must never violate: you cannot delete yourself out
    of your own session, the workspace can never end up with zero active
    super admins, and only a Super Admin can remove an admin/super_admin
    account at all.
    """
    if user_id == actor.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "You cannot delete your own account while signed in as it."
        )

    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    _require_super_admin_for_admin_tier(actor, touches_admin_tier=target.role != UserRole.agent)
    await _assert_not_last_super_admin(db, target)

    await record_audit(
        db,
        actor=actor,
        action="delete",
        entity_type="user",
        entity_id=target.id,
        summary=f"{actor.name} deleted {target.name} ({target.email})",
    )
    await db.delete(target)
    await db.flush()
