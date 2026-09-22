"""The whole authorization model: three tiers.

- `super_admin`: everything, unconditionally. Full system access — users,
  roles, permissions, agents, knowledge bases, workspace settings, and
  system configuration (including the login-requirement toggle, which is
  deliberately not grantable to anyone else).
- `admin`: Settings, Agents and Knowledge Base access, but scoped to
  whichever of GRANTABLE_PERMISSIONS a super_admin has assigned this
  specific person (`User.granted_permissions`) — "Admin" is not one fixed
  bundle, it is whatever the super_admin decided to grant.
- `agent`: day-to-day work only (conversations, requests, inboxes, home),
  plus self-service (own profile/appearance/sessions).

See auth/dependencies.py for the actual enforcement (require_permission /
require_staff / require_super_admin, each a role-and-grant check against the
session's user); `permissions_for` below is also what the frontend reads to
decide what to show — not itself a security boundary on its own.
"""

from app.domains.users.models import User, UserRole

# What a super_admin can hand to a specific admin. Deliberately excludes
# anything that would let an admin touch the workspace's own security
# perimeter in a way that could lock out or outrank the super_admin tier.
GRANTABLE_PERMISSIONS = frozenset(
    {
        "manage_users",
        "manage_agents",
        "manage_knowledge_base",
        "manage_workspace_settings",
        "manage_security",
        "manage_integrations",
        "view_audit_log",
    }
)

# Never grantable — checked as `user.role == UserRole.super_admin` directly,
# not via granted_permissions, so there is no path (bug or otherwise) that
# hands these out by mistake.
SUPER_ADMIN_ONLY = frozenset(
    {
        "manage_login_requirement",
        "manage_admins",  # create/edit/delete admin & super_admin accounts, assign grants
    }
)

EVERYONE = frozenset(
    {
        "handle_conversations",
        "handle_requests",
    }
)

# What a newly-promoted admin starts with, before a super_admin customises
# it — the full grantable bundle, matching "Admin: Access to Settings,
# Agents, and Knowledge Bases" as the sensible default rather than nothing.
DEFAULT_ADMIN_PERMISSIONS = sorted(GRANTABLE_PERMISSIONS)


def permissions_for(user: User) -> list[str]:
    if user.role == UserRole.super_admin:
        return sorted(GRANTABLE_PERMISSIONS | SUPER_ADMIN_ONLY | EVERYONE)
    if user.role == UserRole.admin:
        granted = set(user.granted_permissions) & GRANTABLE_PERMISSIONS
        return sorted(granted | EVERYONE)
    return sorted(EVERYONE)
