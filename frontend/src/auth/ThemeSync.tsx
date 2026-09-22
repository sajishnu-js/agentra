import { useEffect, useRef } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { ACCENTS, type Accent } from '@/theme/accentPalettes'
import { useTheme, type Theme } from '@/theme/ThemeProvider'

function isTheme(value: string): value is Theme {
  return value === 'light' || value === 'dark'
}

function isAccent(value: string): value is Accent {
  return (ACCENTS as string[]).includes(value)
}

/**
 * One-way sync, backend → local theme, applied once per sign-in.
 *
 * Local (localStorage, via ThemeProvider) stays the source of truth for the
 * rest of the session — AppearanceSection writes to both on every change —
 * this only exists to carry a preference recorded on one device onto
 * another the next time you sign in there, rather than resetting to the
 * app's plain default.
 */
export function ThemeSync() {
  const { user } = useAuth()
  const { setTheme, setAccent } = useTheme()
  const appliedForUser = useRef<string | null>(null)

  useEffect(() => {
    if (!user || appliedForUser.current === user.id) return
    appliedForUser.current = user.id
    if (user.theme_preference && isTheme(user.theme_preference)) setTheme(user.theme_preference)
    if (user.accent_preference && isAccent(user.accent_preference)) setAccent(user.accent_preference)
  }, [user, setTheme, setAccent])

  return null
}
