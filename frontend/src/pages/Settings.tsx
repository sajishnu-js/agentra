import {
  Bell,
  Bot,
  Building2,
  History,
  KeyRound,
  Laptop,
  Palette,
  Plug,
  Shield,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { AccountSection } from '@/pages/settings/AccountSection'
import { AgentAssignmentSection } from '@/pages/settings/AgentAssignmentSection'
import { AiModelSection } from '@/pages/settings/AiModelSection'
import { AppearanceSection } from '@/pages/settings/AppearanceSection'
import { AuditLogSection } from '@/pages/settings/AuditLogSection'
import { IntegrationsSection } from '@/pages/settings/IntegrationsSection'
import { NotificationsSection } from '@/pages/settings/NotificationsSection'
import { ProfileSection } from '@/pages/settings/ProfileSection'
import { SecuritySection } from '@/pages/settings/SecuritySection'
import { SessionsSection } from '@/pages/settings/SessionsSection'
import { UsersSection } from '@/pages/settings/UsersSection'
import { WorkspaceSection } from '@/pages/settings/WorkspaceSection'

type SectionDef = {
  key: string
  label: string
  icon: LucideIcon
  /** Absent = self-service, open to anyone signed in. Present = only shown
   * when hasPermission(x) — a super_admin always has every permission; an
   * admin only whatever a super_admin granted them (Users & Roles). This is
   * a UI convenience mirroring the API's own enforcement
   * (auth/dependencies.require_permission), not the security boundary
   * itself — a hidden nav item is not what stops a 403. */
  requiredPermission?: string
  element: ReactNode
}

const PERSONAL_SECTIONS: SectionDef[] = [
  { key: 'profile', label: 'Profile', icon: UserRound, element: <ProfileSection /> },
  { key: 'account', label: 'Account', icon: KeyRound, element: <AccountSection /> },
  { key: 'appearance', label: 'Appearance', icon: Palette, element: <AppearanceSection /> },
  { key: 'sessions', label: 'Sessions', icon: Laptop, element: <SessionsSection /> },
]

const WORKSPACE_SECTIONS: SectionDef[] = [
  {
    key: 'users',
    label: 'Users & Roles',
    icon: Users,
    requiredPermission: 'manage_users',
    element: <UsersSection />,
  },
  {
    key: 'agents',
    label: 'Agents & Knowledge Base',
    icon: Bot,
    requiredPermission: 'manage_agents',
    element: <AgentAssignmentSection />,
  },
  {
    key: 'workspace',
    label: 'Workspace',
    icon: Building2,
    requiredPermission: 'manage_workspace_settings',
    element: <WorkspaceSection />,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: Bell,
    requiredPermission: 'manage_workspace_settings',
    element: <NotificationsSection />,
  },
  {
    key: 'ai',
    label: 'AI & Model',
    icon: Sparkles,
    requiredPermission: 'manage_workspace_settings',
    element: <AiModelSection />,
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: Plug,
    requiredPermission: 'manage_integrations',
    element: <IntegrationsSection />,
  },
  {
    key: 'security',
    label: 'Security',
    icon: Shield,
    requiredPermission: 'manage_security',
    element: <SecuritySection />,
  },
  {
    key: 'audit',
    label: 'Audit Log',
    icon: History,
    requiredPermission: 'view_audit_log',
    element: <AuditLogSection />,
  },
]

function NavGroup({
  title,
  sections,
  hasPermission,
}: {
  title: string
  sections: SectionDef[]
  hasPermission: (permission: string) => boolean
}) {
  const visible = sections.filter((section) => !section.requiredPermission || hasPermission(section.requiredPermission))
  if (!visible.length) return null

  return (
    <div>
      <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-foreground-subtle uppercase">
        {title}
      </p>
      <div className="flex flex-col gap-0.5">
        {visible.map((section) => (
          <NavLink
            key={section.key}
            to={`/app/settings/${section.key}`}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gradient-to-r from-brand-soft to-transparent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground',
              )
            }
          >
            <section.icon className="size-4 shrink-0" />
            <span className="truncate">{section.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}

/**
 * One page, sub-routed by `settings/*` (see App.tsx) rather than a dozen
 * top-level routes — the section list lives here, not scattered across the
 * router config, since it's also what drives the nav. Each workspace
 * section is hidden unless the signed-in user actually has the specific
 * permission its own screen would need to do anything — a super_admin
 * always does; a plain admin only what a super_admin granted them. Typing
 * an unauthorized section's URL directly redirects to Profile — the API
 * enforces the real boundary (require_permission on each endpoint)
 * independent of this UI hiding.
 */
export function Settings() {
  const { hasPermission } = useAuth()
  const allSections = [...PERSONAL_SECTIONS, ...WORKSPACE_SECTIONS]

  return (
    <div className="flex h-full min-h-0 gap-4">
      <nav className="glass flex w-60 shrink-0 flex-col gap-5 overflow-y-auto rounded-2xl p-3">
        <NavGroup title="You" sections={PERSONAL_SECTIONS} hasPermission={hasPermission} />
        <NavGroup title="Workspace" sections={WORKSPACE_SECTIONS} hasPermission={hasPermission} />
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto pr-1 pb-4">
        <Routes>
          <Route index element={<Navigate to="profile" replace />} />
          {allSections.map((section) => (
            <Route
              key={section.key}
              path={section.key}
              element={
                !section.requiredPermission || hasPermission(section.requiredPermission) ? (
                  section.element
                ) : (
                  <Navigate to="../profile" replace />
                )
              }
            />
          ))}
          {/* Absolute, not relative. On a splat route the relative base
              includes the matched splat, so `to="profile"` resolved against
              /app/settings/<unknown> produced /app/settings/<unknown>/profile
              — which does not match a section either, so the catch-all fired
              again, appending /profile forever until React threw "Maximum
              update depth exceeded". Any mistyped or stale settings URL hung
              the page. An absolute target lands somewhere real on the first
              redirect. */}
          <Route path="*" element={<Navigate to="/app/settings/profile" replace />} />
        </Routes>
      </div>
    </div>
  )
}
