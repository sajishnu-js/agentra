import {
  Bot,
  BookOpen,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Settings2,
  Ticket,
  Workflow,
} from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { BrandMark } from '@/components/layout/BrandMark'
import { Badge } from '@/components/ui/badge'
import { useApi } from '@/hooks/useApi'
import type { NavCounts } from '@/lib/types'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  to: string
  icon: typeof LayoutDashboard
  /** Which live count, if any, to show as a badge. */
  badge?: keyof NavCounts
  adminOnly?: boolean
}

const primaryNav: NavItem[] = [
  { label: 'Home', to: '/app', icon: LayoutDashboard },
  { label: 'Agents', to: '/app/agents', icon: Bot, adminOnly: true },
  { label: 'Knowledge Base', to: '/app/knowledge-base', icon: BookOpen, adminOnly: true },
  { label: 'Workflow', to: '/app/workflows', icon: Workflow, adminOnly: true },
  { label: 'Requests Hub', to: '/app/requests', icon: Ticket, badge: 'pending_requests' },
  { label: 'Inboxes', to: '/app/inboxes', icon: Inbox },
  {
    label: 'Conversations',
    to: '/app/conversations',
    icon: MessagesSquare,
    badge: 'open_conversations',
  },
]

const secondaryNav: NavItem[] = [
  { label: 'Settings', to: '/app/settings', icon: Settings2 },
]

function NavRow({ item, counts }: { item: NavItem; counts: NavCounts | null }) {
  const Icon = item.icon
  const count = item.badge && counts ? counts[item.badge] : undefined

  return (
    <NavLink
      to={item.to}
      end={item.to === '/' || item.to === '/app'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 overflow-hidden rounded-xl px-2 py-2 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-gradient-to-r from-brand-soft to-transparent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:translate-x-0.5 hover:bg-sidebar-accent/40 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active indicator — a soft breathing glow, not just a static bar. */}
          <span
            aria-hidden
            className={cn(
              'absolute left-0 h-6 w-[3px] shrink-0 rounded-r-full bg-brand transition-opacity duration-300',
              isActive ? 'glow-pulse opacity-100' : 'opacity-0 group-hover:opacity-40',
            )}
          />
          {/* Icon chip — a small raised surface, not a bare glyph, so it
              reads as a button rather than a label. Lifts and glows on
              hover/active instead of just a colour change. */}
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-lg transition-all duration-200',
              isActive
                ? 'bg-brand-soft text-brand-text shadow-[0_2px_10px_-3px_var(--brand)]'
                : 'text-muted-foreground group-hover:scale-110 group-hover:bg-sidebar-accent/70 group-hover:text-foreground group-hover:shadow-[0_2px_8px_-3px_var(--brand)]',
            )}
          >
            <Icon className="size-4" />
          </span>
          <span className="flex-1 truncate">{item.label}</span>
          {count ? (
            <Badge className="h-5 min-w-5 px-1.5 text-[11px] tabular-nums">
              {count}
            </Badge>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin'
  // "Agents config, Knowledge Base... admin-only" — same boundary the
  // previous, now-removed password+JWT auth documented and enforced (see
  // README's "Auth and team management"), and what the API itself now gates
  // (require_admin on those routers) independent of this hiding — this is
  // purely so an agent-role user isn't offered a link that would bounce them
  // straight back (see App.tsx's RequireAdmin).
  const visiblePrimaryNav = primaryNav.filter((item) => !item.adminOnly || isAdmin)

  // Polled, because the Telegram worker writes to these tables from outside
  // the browser — a new thread has to show up without a reload.
  const { data: counts } = useApi<NavCounts>('/analytics/nav-counts', {
    pollMs: 15000,
  })

  return (
    <aside className="glass glass-sheen relative hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl p-3 md:flex">
      {/* Ambient depth, not another WebGL canvas — two soft blurred washes
          in the theme's two accent colours, strictly behind the nav
          content (-z-10 inside this glass panel's own stacking context,
          which backdrop-filter already establishes — see AmbientScene's
          history with the same trick at the page level). */}
      <div
        aria-hidden
        className="ambient-glow absolute -top-14 -left-14 -z-10 size-40 bg-brand opacity-25"
      />
      <div
        aria-hidden
        className="ambient-glow absolute -right-16 bottom-24 -z-10 size-48 bg-brand-2 opacity-[0.18]"
      />

      <Link
        to="/"
        className="flex items-center gap-3 rounded-xl px-2 pt-2 pb-4 transition-opacity hover:opacity-80"
        aria-label="Back to the opening page"
      >
        <BrandMark />
      </Link>

      <div className="rule-fade mb-2" />

      <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-foreground-subtle uppercase">
        Menu
      </p>
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
        {visiblePrimaryNav.map((item) => (
          <NavRow key={item.to} item={item} counts={counts} />
        ))}
      </nav>

      <div className="rule-fade mb-1" />
      <nav className="flex flex-col gap-0.5" aria-label="Workspace">
        {secondaryNav.map((item) => (
          <NavRow key={item.to} item={item} counts={counts} />
        ))}
      </nav>
    </aside>
  )
}
