from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_name: str
    support_email: str | None = None
    default_language: str
    timezone: str
    notify_new_request: bool
    notify_handover: bool
    notify_agent_error: bool
    notify_daily_summary: bool
    session_idle_timeout_minutes: int
    audit_log_retention_days: int
    require_confirmation_for_deletes: bool
    ip_allowlist: str | None = None
    default_model: str
    default_temperature: float
    default_max_output_tokens: int


class WorkspaceSettingsUpdate(BaseModel):
    """PATCH /settings/workspace — the non-security subset."""

    workspace_name: str | None = Field(default=None, min_length=1, max_length=120)
    support_email: str | None = None
    default_language: str | None = Field(default=None, min_length=2, max_length=10)
    timezone: str | None = None
    notify_new_request: bool | None = None
    notify_handover: bool | None = None
    notify_agent_error: bool | None = None
    notify_daily_summary: bool | None = None
    default_model: str | None = None
    default_temperature: float | None = Field(default=None, ge=0, le=2)
    # Same floor as AgentCreate/AgentUpdate — see the comment there.
    default_max_output_tokens: int | None = Field(default=None, ge=256, le=8192)


class SecuritySettingsUpdate(BaseModel):
    """PATCH /settings/security — split from workspace settings so it can be
    gated by its own, tighter permission (see api.py)."""

    session_idle_timeout_minutes: int | None = Field(default=None, ge=5, le=525600)
    audit_log_retention_days: int | None = Field(default=None, ge=1, le=3650)
    require_confirmation_for_deletes: bool | None = None
    ip_allowlist: str | None = None


class LoginRequirementRead(BaseModel):
    """Deliberately its own schema, not a field on WorkspaceSettingsRead —
    only a super_admin can even see this value (see settings/router.py)."""

    require_login: bool


class IntegrationStatus(BaseModel):
    """Read-only introspection of env-configured integrations. Never the
    secret values themselves — those live only in backend/.env, per the
    standing instruction that API keys are provided in the backend, not
    round-tripped through this UI."""

    llm_provider: str
    gemini_configured: bool
    gemini_model: str
    telegram_configured: bool
    # Split per secret, not one combined "whatsapp_configured" bool: the GET
    # verify handshake only needs the verify token while the POST signature
    # check only needs the app secret (see app/webhooks/router.py), so an
    # admin midway through setup benefits from knowing which half is still
    # missing rather than a single flag that hides that distinction.
    whatsapp_verify_token_configured: bool
    whatsapp_app_secret_configured: bool
    instagram_verify_token_configured: bool
    instagram_app_secret_configured: bool
    email_webhook_secret_configured: bool
    # None in a dev environment that hasn't set one — the webhook URL display
    # in the Inboxes UI falls back to a relative path plus a configure-this
    # hint rather than pretending this app has a public origin it doesn't.
    public_base_url: str | None = None
