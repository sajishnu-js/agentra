import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Bell, LogOut, Search, Settings2, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { BusinessHoursBadge } from '@/components/BusinessHoursBadge'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { ThemeSelectorCompact } from '@/components/ThemeSelector'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { initials, relativeTime } from '@/lib/format'
import type { Notification, SearchResult } from '@/lib/types'
import { cn } from '@/lib/utils'

/** A real, if deliberately simple, cross-app search — a union of a few
 * cheap ILIKE queries server-side (see app/domains/search/router.py), not a
 * full search engine. Plain controlled input + manual results panel rather
 * than a Radix primitive: a type-ahead combobox opens based on "has
 * results", not a click, which doesn't fit DropdownMenu/Popover's own
 * trigger-driven open model any better than this does. */
function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const data = await api.get<SearchResult[]>(`/search?q=${encodeURIComponent(trimmed)}`)
        setResults(data)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function handleSelect(result: SearchResult) {
    setOpen(false)
    setQuery('')
    navigate(result.link)
  }

  return (
    <div ref={containerRef} className="relative hidden w-64 lg:block">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle"
      />
      <Input
        placeholder="Search…"
        className="glass pl-9"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && query.trim().length >= 2 ? (
        <div className="glass-strong absolute top-full left-0 z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl p-2">
          {loading ? (
            <p className="p-2.5 text-xs text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-2.5 text-xs text-muted-foreground">No matches for "{query}"</p>
          ) : (
            results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                onClick={() => handleSelect(result)}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="truncate text-sm font-medium">{result.title}</span>
                <span className="text-[11px] text-muted-foreground">{result.subtitle}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function NotificationBell() {
  const { data: notifications, reload } = useApi<Notification[]>('/notifications', {
    pollMs: 20000,
  })
  const { data: unread } = useApi<{ count: number }>('/notifications/unread-count', {
    pollMs: 20000,
  })
  const navigate = useNavigate()
  const active = Boolean(unread && unread.count > 0)

  async function handleMarkAllRead() {
    try {
      await api.post('/notifications/read-all', {})
      reload()
    } catch {
      // Best-effort — nothing destructive is at stake in re-checking later.
    }
  }

  async function handleSelect(notification: Notification) {
    if (!notification.is_read) {
      try {
        await api.patch(`/notifications/${notification.id}`, {})
      } catch {
        // Best-effort; still navigate either way.
      }
      reload()
    }
    if (notification.link) navigate(notification.link)
  }

  return (
    <DropdownMenu.Root>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu.Trigger asChild>
            <Button variant="glass" size="icon" className="relative rounded-full">
              <Bell className="size-4" />
              {active ? (
                <span
                  aria-hidden
                  className="glow-pulse absolute top-2 right-2.5 size-1.5 rounded-full bg-brand"
                />
              ) : null}
              <span className="sr-only">
                {active ? `${unread?.count} unread notifications` : 'No new notifications'}
              </span>
            </Button>
          </DropdownMenu.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active ? `${unread?.count} unread notification(s)` : 'No new notifications'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className={cn(
            'glass-strong z-50 flex max-h-96 w-80 flex-col gap-1 overflow-y-auto rounded-2xl p-2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Notifications</span>
            {active ? (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-[11px] text-brand-text hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="rule-fade" />
          {!notifications?.length ? (
            <p className="p-3 text-center text-xs text-muted-foreground">No notifications yet</p>
          ) : (
            notifications.map((notification) => (
              <DropdownMenu.Item
                key={notification.id}
                onSelect={() => void handleSelect(notification)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent',
                  !notification.is_read && 'bg-brand-soft/50',
                )}
              >
                <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                  {!notification.is_read ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  ) : null}
                  <span className="truncate">{notification.title}</span>
                </span>
                {notification.body ? (
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">
                    {notification.body}
                  </span>
                ) : null}
                <span className="text-[10px] text-foreground-subtle">
                  {relativeTime(notification.created_at)}
                </span>
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function UserMenu() {
  const { user, implicit, signOut } = useAuth()
  if (!user) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="glass flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:border-brand/40"
        >
          <Avatar className="size-7">
            <AvatarImage src={user.avatar_url ?? undefined} alt={user.name} />
            <AvatarFallback className="text-[10px]">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-28 truncate text-sm font-medium sm:inline">{user.name}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className={cn(
            'glass-strong z-50 flex w-56 flex-col gap-1 rounded-2xl p-2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            {implicit ? (
              <p className="mt-1 text-[11px] text-foreground-subtle">
                Not signed in — Login Requirement is off, so you're using this workspace's default
                identity.
              </p>
            ) : null}
          </div>
          <div className="rule-fade" />
          <DropdownMenu.Item asChild className="outline-none">
            <Link
              to="/app/settings/profile"
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-accent"
            >
              <UserRound className="size-4 text-muted-foreground" />
              Profile
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className="outline-none">
            <Link
              to="/app/settings"
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-accent"
            >
              <Settings2 className="size-4 text-muted-foreground" />
              Settings
            </Link>
          </DropdownMenu.Item>
          <div className="rule-fade" />
          {implicit ? (
            <DropdownMenu.Item asChild className="outline-none">
              <Link
                to="/signin"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-accent"
              >
                <LogOut className="size-4 text-muted-foreground" />
                Sign in as yourself
              </Link>
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              onSelect={() => void signOut()}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-destructive outline-none transition-colors hover:bg-destructive/10"
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Topbar({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 px-1 pt-1">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {Icon ? (
          <span className="glass grid size-10 shrink-0 place-items-center rounded-xl text-brand-text shadow-[0_2px_14px_-4px_var(--brand)]">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <BusinessHoursBadge />

      <GlobalSearch />

      <NotificationBell />

      {/* Accent picker (brown/silver/blue/green) — compact, separate from
          the light/dark toggle beside it, both pinned to the top-right. */}
      <ThemeSelectorCompact />
      <ThemeToggle />
      <UserMenu />
    </header>
  )
}
