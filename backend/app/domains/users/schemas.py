from datetime import datetime
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domains.users.models import UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    is_active: bool = True
    # Plain str: this is a read schema fed from our own rows, so there is
    # nothing to validate. Write endpoints should use pydantic[email].
    email: str
    avatar_url: str | None = None
    role: UserRole
    job_title: str | None = None
    phone: str | None = None
    # NULL means "use the workspace default" — see User.timezone.
    timezone: str | None = None
    theme_preference: str | None = None
    accent_preference: str | None = None
    # Only meaningful when role == admin — see auth/permissions.py.
    granted_permissions: list[str] = Field(default_factory=list)
    created_at: datetime


class UserUpdate(BaseModel):
    """Self-service — PATCH /users/me. Deliberately no role or is_active
    here: those are workspace administration, not profile editing, and live
    on UserUpdateAdmin instead."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=500)
    job_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    # NULL means "use the workspace default", not "UTC" or any other
    # hardcoded stand-in — see User.timezone.
    timezone: str | None = Field(default=None, max_length=64)
    theme_preference: str | None = Field(default=None, max_length=10)
    accent_preference: str | None = Field(default=None, max_length=20)

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str | None) -> str | None:
        if value is not None and value not in available_timezones():
            raise ValueError(f"{value!r} is not a recognized IANA timezone name")
        return value


class UserCreate(BaseModel):
    """POST /users. Creating an agent needs `manage_users`; creating an
    admin or super_admin is Super Admin only — see users/router.py."""

    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=255)
    role: UserRole = UserRole.agent
    job_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=500)
    # Admin only; empty means "use the default bundle" — see
    # auth/permissions.py:DEFAULT_ADMIN_PERMISSIONS. Ignored for any other role.
    granted_permissions: list[str] = Field(default_factory=list)


class UserUpdateAdmin(BaseModel):
    """PATCH /users/{id} — editing anyone, including role, activation and
    granted permissions. Separate from the self-service UserUpdate so a
    compromised or buggy profile form can never smuggle in a role change.
    Touching role/granted_permissions, or a target who is already admin/
    super_admin, is Super Admin only — see users/router.py."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=500)
    job_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    role: UserRole | None = None
    is_active: bool | None = None
    granted_permissions: list[str] | None = None


class UserWorkload(BaseModel):
    """A staff member and how much they are currently holding."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    avatar_url: str | None = None
    role: UserRole
    open_conversations: int
    open_requests: int
