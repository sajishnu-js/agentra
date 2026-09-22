from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.domains.users.schemas import UserRead


class LoginRequest(BaseModel):
    # Plain str, not EmailStr — matches the rest of this codebase (see
    # users/schemas.py's own note on why pydantic[email] isn't pulled in yet).
    # An unknown address just gets the same 401 as any other bad login.
    email: str


class LoginResponse(BaseModel):
    token: str
    user: UserRead
    permissions: list[str]


class MeResponse(BaseModel):
    user: UserRead
    permissions: list[str]
    # True when there's no real session behind this response — Login
    # Requirement is off and nobody explicitly signed in, so `user` is the
    # implicit fallback identity (see auth/dependencies.py:_implicit_user).
    implicit: bool = False


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    last_seen_at: datetime
    user_agent: str | None = None
    ip_address: str | None = None
    is_current: bool = False
