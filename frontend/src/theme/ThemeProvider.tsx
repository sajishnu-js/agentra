import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { ACCENTS, type Accent } from '@/theme/accentPalettes'

export type Theme = 'light' | 'dark'

const MODE_KEY = 'agentra.theme'
const ACCENT_KEY = 'agentra.accent'

function readStoredMode(fallback: Theme): Theme {
  const stored = localStorage.getItem(MODE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : fallback
}

function readStoredAccent(fallback: Accent): Accent {
  const stored = localStorage.getItem(ACCENT_KEY)
  return stored && (ACCENTS as string[]).includes(stored) ? (stored as Accent) : fallback
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  accent: Accent
  setAccent: (accent: Accent) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Holds the active theme (light/dark) and accent (brown/silver/blue/green)
 * in React state, mirrored onto <html> as the `dark` class plus a
 * `data-accent` attribute. Every colour in the app is a CSS custom property
 * scoped to those selectors (see index.css), so flipping them re-themes the
 * whole tree instantly — no component re-renders, no reload, just a
 * class/attribute swap the browser repaints for free.
 *
 * Both persist to localStorage. `index.html` hardcodes `class="dark"
 * data-accent="blue"` as the static default so first paint already matches
 * what most visitors will see with nothing stored yet; this only touches the
 * DOM when a stored value differs from that default.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  defaultAccent = 'silver',
}: {
  children: ReactNode
  defaultTheme?: Theme
  defaultAccent?: Accent
}) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredMode(defaultTheme))
  const [accent, setAccentState] = useState<Accent>(() => readStoredAccent(defaultAccent))

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(MODE_KEY, next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem(MODE_KEY, next)
      return next
    })
  }, [])

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next)
    localStorage.setItem(ACCENT_KEY, next)
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent }),
    [theme, setTheme, toggleTheme, accent, setAccent],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>')
  }
  return context
}
