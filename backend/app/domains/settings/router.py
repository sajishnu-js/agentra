"""Workspace settings the dashboard — and now the Settings screen — reads."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.core.database import get_db
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import require_permission, require_staff, require_super_admin
from app.domains.settings.business_hours import BusinessHoursStatus, status
from app.domains.settings.models import WorkspaceSettings, get_or_create_workspace_settings
from app.domains.settings.schemas import (
    IntegrationStatus,
    LoginRequirementRead,
    SecuritySettingsUpdate,
    WorkspaceSettingsRead,
    WorkspaceSettingsUpdate,
)
from app.domains.users.models import User

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/business-hours", response_model=BusinessHoursStatus)
async def business_hours() -> BusinessHoursStatus:
    """Whether the business is open right now, and when it next opens.

    Computed server-side so the answer does not depend on the viewer's own
    clock or timezone — a staff member checking from London should see the
    business's hours, not their own.
    """
    return status()


@router.get("/workspace", response_model=WorkspaceSettingsRead)
async def read_workspace_settings(
    _: User = Depends(require_staff), db: AsyncSession = Depends(get_db)
) -> WorkspaceSettings:
    """Everything on the Settings screen reads from here in one call —
    including the security-only fields, since fragmenting the read across two
    endpoints would just mean two round trips to render one page. Any admin
    or super_admin can view it; the two PATCH endpoints below are what's
    actually split by granted permission. `require_login` is deliberately
    NOT in this response's schema at all — see /login-requirement."""
    return await get_or_create_workspace_settings(db)


@router.patch("/workspace", response_model=WorkspaceSettingsRead)
async def update_workspace_settings(
    payload: WorkspaceSettingsUpdate,
    user: User = Depends(require_permission("manage_workspace_settings")),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSettings:
    row = await get_or_create_workspace_settings(db)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(row, field, value)
    await db.flush()
    if changes:
        await record_audit(
            db,
            actor=user,
            action="update",
            entity_type="workspace_settings",
            entity_id=row.id,
            summary=f"{user.name} updated workspace settings ({', '.join(sorted(changes))})",
            context=changes,
        )
    await db.refresh(row)
    return row


@router.patch("/security", response_model=WorkspaceSettingsRead)
async def update_security_settings(
    payload: SecuritySettingsUpdate,
    user: User = Depends(require_permission("manage_security")),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSettings:
    row = await get_or_create_workspace_settings(db)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(row, field, value)
    await db.flush()
    if changes:
        await record_audit(
            db,
            actor=user,
            action="update",
            entity_type="security_settings",
            entity_id=row.id,
            summary=f"{user.name} updated security settings ({', '.join(sorted(changes))})",
            context=changes,
        )
    await db.refresh(row)
    return row


@router.get("/login-requirement", response_model=LoginRequirementRead)
async def read_login_requirement(
    _: User = Depends(require_super_admin), db: AsyncSession = Depends(get_db)
) -> WorkspaceSettings:
    """Super Admin only — not even a plain admin can see whether login is
    required, matching the brief's "only the Super Admin can view and
    change this setting" exactly (not just "change")."""
    return await get_or_create_workspace_settings(db)


@router.patch("/login-requirement", response_model=LoginRequirementRead)
async def update_login_requirement(
    payload: LoginRequirementRead,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSettings:
    row = await get_or_create_workspace_settings(db)
    if row.require_login != payload.require_login:
        row.require_login = payload.require_login
        await db.flush()
        await record_audit(
            db,
            actor=user,
            action="update",
            entity_type="security_settings",
            entity_id=row.id,
            summary=(
                f"{user.name} turned login requirement "
                f"{'ON' if payload.require_login else 'OFF'}"
            ),
            context={"require_login": payload.require_login},
        )
    await db.refresh(row)
    return row


@router.get("/integrations", response_model=IntegrationStatus)
async def integration_status(_: User = Depends(require_staff)) -> dict:
    """Live introspection of env-configured integrations — never the secret
    values themselves, just whether one is set."""
    return {
        "llm_provider": env_settings.llm_provider,
        "gemini_configured": bool(env_settings.gemini_api_key),
        "gemini_model": env_settings.gemini_model,
        "telegram_configured": bool(env_settings.telegram_bot_token),
        "whatsapp_verify_token_configured": bool(env_settings.whatsapp_verify_token),
        "whatsapp_app_secret_configured": bool(env_settings.whatsapp_app_secret),
        "instagram_verify_token_configured": bool(env_settings.instagram_verify_token),
        "instagram_app_secret_configured": bool(env_settings.instagram_app_secret),
        "email_webhook_secret_configured": bool(env_settings.email_webhook_secret),
        "public_base_url": env_settings.public_base_url,
    }
