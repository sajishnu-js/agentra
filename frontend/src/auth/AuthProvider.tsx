import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api, onUnauthorized, setAuthToken } from '@/lib/api'
import { CLINIC_TIMEZONE } from '@/lib/format'
import type { MeResponse, User } from '@/lib/types'

const TOKEN_KEY = 'agentra.session_token'

type Status = 'loading' | 'signed-in' | 'signed-out'

type AuthContextValue = {
  user: User | null
  permissions: Set<string>
  status: Status
  /** True when there's no real session behind the current identity — Login
   * Requirement is off (Settings → Workspace, Super Admin only) and nobody
   * explicitly signed in, so `user` is the implicit fallback account. */
  implicit: boolean
  /** This person's own override (Settings → Profile) if they set one, else
   * the app's clinic default — see lib/format.ts's CLINIC_TIMEZONE. Not the
   * workspace's own configurable timezone (Settings → Workspace): that
   * screen is admin-only, so a plain agent-role user could never read it,
   * and business-metric surfaces (dashboard, business-hours badge) are
   * deliberately keyed to the business's clock regardless of viewer. */
  timezone: string
  signIn: (email: string) => Promise<void>
  signOut: () => Promise<void>
  /** Re-fetches /auth/me — call after editing your own profile so the
   * sidebar/topbar avatar and name update without a full reload. */
  refreshUser: () => Promise<void>
  hasPermission: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Owns the signed-in identity for the whole app: reads a stored session
 * token on boot (if any) and always checks /auth/me, because a valid
 * identity doesn't require a token when Login Requirement is off — the
 * backend hands back an implicit one (see backend's auth/dependencies.py).
 * Only a genuine 401 from that check means "show the sign-in screen."
 *
 * There is no password behind an explicit sign-in either — see
 * backend/app/domains/auth/models.py for why. This provider's job is
 * identity and session *tracking*, the same shape a credentialed system
 * would have, against a lighter mechanism underneath.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<Set<string>>(new Set())
  const [implicit, setImplicit] = useState(false)
  const [status, setStatus] = useState<Status>('loading')

  const applySession = useCallback((token: string | null, me: MeResponse) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
      setAuthToken(token)
    }
    setUser(me.user)
    setPermissions(new Set(me.permissions))
    setImplicit(me.implicit)
    setStatus('signed-in')
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setAuthToken(null)
    setUser(null)
    setPermissions(new Set())
    setImplicit(false)
    setStatus('signed-out')
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) setAuthToken(stored)
    // Called unconditionally, token or not: with Login Requirement off this
    // still succeeds (as the implicit identity); only a real 401 (required
    // and no valid session) means "show the sign-in screen."
    api
      .get<MeResponse>('/auth/me')
      .then((me) => applySession(stored, me))
      .catch(() => clearSession())
  }, [applySession, clearSession])

  useEffect(() => onUnauthorized(clearSession), [clearSession])

  const signIn = useCallback(
    async (email: string) => {
      const response = await api.post<{ token: string; user: User; permissions: string[] }>(
        '/auth/sessions',
        { email },
      )
      applySession(response.token, {
        user: response.user,
        permissions: response.permissions,
        implicit: false,
      })
    },
    [applySession],
  )

  const signOut = useCallback(async () => {
    try {
      await api.delete('/auth/sessions/current')
    } catch {
      // Already gone server-side (expired, or already signed out elsewhere)
      // — clearing local state is still the right outcome either way.
    }
    clearSession()
    // If Login Requirement is off, clearing the token doesn't lead to a
    // sign-in wall — the next /auth/me (App.tsx re-mounts RequireAuth on
    // status change) resolves back to the implicit identity, which is
    // correct: "signed out" has no meaning when signing in was optional.
    try {
      const me = await api.get<MeResponse>('/auth/me')
      applySession(null, me)
    } catch {
      // Login Requirement is on (or no active account exists) — stay signed out.
    }
  }, [clearSession, applySession])

  const refreshUser = useCallback(async () => {
    const me = await api.get<MeResponse>('/auth/me')
    setUser(me.user)
    setPermissions(new Set(me.permissions))
    setImplicit(me.implicit)
  }, [])

  const hasPermission = useCallback((permission: string) => permissions.has(permission), [permissions])
  const timezone = user?.timezone ?? CLINIC_TIMEZONE

  const value = useMemo(
    () => ({ user, permissions, implicit, status, timezone, signIn, signOut, refreshUser, hasPermission }),
    [user, permissions, implicit, status, timezone, signIn, signOut, refreshUser, hasPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
