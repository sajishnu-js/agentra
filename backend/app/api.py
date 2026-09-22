"""Aggregates every domain router under a single API prefix.

Adding a domain means adding one import and one include_router line here.

Authentication is applied here, not scattered across every router: every
domain except auth itself requires a valid session (`get_current_user`) to
reach any of its routes, because `include_router(..., dependencies=[...])`
runs a dependency for its side effect on every route in that router without
each route having to declare it. auth_router is mounted with no such
dependency — POST /auth/sessions (signing in) is the one endpoint in the
whole API that must work with no session yet.

knowledge_base_router is mounted `require_staff` outright (any admin or
super_admin can at least see it — "Settings, Agents, Knowledge Base" per the
brief); audit_router requires the `view_audit_log` permission specifically.
Routers with a narrower split (some routes open to any signed-in user, some
gated by a specific permission — agents, users, settings) apply
`Depends(require_permission(...))` themselves on just those routes instead.
"""

from fastapi import APIRouter, Depends

from app.domains.agents.router import router as agents_router
from app.domains.analytics.router import router as analytics_router
from app.domains.audit.router import router as audit_router
from app.domains.auth.dependencies import get_current_user, require_permission, require_staff
from app.domains.auth.router import router as auth_router
from app.domains.contacts.router import router as contacts_router
from app.domains.conversations.router import router as conversations_router
from app.domains.inboxes.router import router as inboxes_router
from app.domains.knowledge_base.router import router as knowledge_base_router
from app.domains.notifications.router import router as notifications_router
from app.domains.requests.router import router as requests_router
from app.domains.search.router import router as search_router
from app.domains.settings.router import router as settings_router
from app.domains.users.router import router as users_router
from app.domains.workflows.router import router as workflows_router

_signed_in = [Depends(get_current_user)]

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(agents_router, dependencies=_signed_in)
api_router.include_router(analytics_router, dependencies=_signed_in)
api_router.include_router(audit_router, dependencies=[Depends(require_permission("view_audit_log"))])
api_router.include_router(contacts_router, dependencies=_signed_in)
api_router.include_router(conversations_router, dependencies=_signed_in)
api_router.include_router(inboxes_router, dependencies=_signed_in)
api_router.include_router(knowledge_base_router, dependencies=[Depends(require_staff)])
api_router.include_router(notifications_router, dependencies=_signed_in)
api_router.include_router(requests_router, dependencies=_signed_in)
api_router.include_router(search_router, dependencies=_signed_in)
api_router.include_router(settings_router, dependencies=_signed_in)
api_router.include_router(users_router, dependencies=_signed_in)
# require_staff, like knowledge_base: a workflow can change agent
# configuration and message customers, so building one is squarely on the
# admin side of "Agents config, Knowledge Base... only Super Admin and Admin".
api_router.include_router(workflows_router, dependencies=[Depends(require_staff)])
