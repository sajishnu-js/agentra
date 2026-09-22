/**
 * Landing page design explorations.
 *
 * PREVIEW ONLY — nothing in this folder is referenced by the live landing
 * page (`src/pages/Landing.tsx`), which is untouched. These render at
 * /preview and /preview/1..5 so alternatives can be compared side by side
 * before anything is adopted. Deleting this folder plus the two preview
 * routes in App.tsx removes the whole experiment with no other trace.
 */
import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ThemeSelectorCompact } from '@/components/ThemeSelector'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme/ThemeProvider'

export const Logo3D = lazy(() => import('@/scene/Logo3D').then((m) => ({ default: m.Logo3D })))
export const HeroMark = lazy(() => import('@/scene/HeroMark').then((m) => ({ default: m.HeroMark })))
export const LandingScene = lazy(() =>
  import('@/scene/LandingScene').then((m) => ({ default: m.LandingScene })),
)

/** Four treatments of the same spiral — see ./spiral.tsx. */
export const DESIGNS = [
  { id: 1, name: 'Void Cathedral', blurb: 'Volumetric god rays cast by the spiral itself' },
  { id: 2, name: 'Diamond Core', blurb: 'The Agentra mark glowing inside the coil' },
  { id: 3, name: 'Plasma Vortex', blurb: '14k points falling into the spiral' },
  { id: 4, name: 'Prism Hall', blurb: 'Iridescent strand on a black mirror' },
]

/**
 * Every one of these five is a *dark* set-piece: additive blending, bloom and
 * vignette all read as light emitted from a dark room, and none of them
 * survive being composited onto a white page. So the preview pins the app to
 * dark mode while it is open and restores the real preference on the way out
 * — otherwise the scene stays black while the text tokens flip to their
 * light-mode values and the body copy all but disappears.
 *
 * The accent picker stays: the seven colourways are the comparison that
 * actually matters here. Light mode is a decision to make *after* a design is
 * chosen, not something to fake across all five.
 */
function usePinnedDarkMode() {
  const { theme, setTheme } = useTheme()
  useEffect(() => {
    if (theme === 'dark') return
    setTheme('dark')
    return () => setTheme(theme)
    // Deliberately mount-only: re-running on every `theme` change would
    // immediately undo the restore this schedules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Shared chrome: brand mark, theme controls, and a switcher so all five can
 * be flipped through quickly. Not part of any design — it is scaffolding. */
export function PreviewShell({
  current,
  children,
  className,
}: {
  current: number
  children: React.ReactNode
  className?: string
}) {
  usePinnedDarkMode()

  return (
    <div className={cn('relative min-h-screen w-full overflow-x-hidden', className)}>
      {children}

      {/* Preview switcher — would not ship. */}
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="glass-strong flex items-center gap-1 rounded-full p-1.5">
          <span className="px-2 text-[10px] tracking-wide text-foreground-subtle uppercase">
            Design
          </span>
          {DESIGNS.map((d) => (
            <Link
              key={d.id}
              to={`/preview/${d.id}`}
              title={`${d.name} — ${d.blurb}`}
              className={cn(
                'grid size-7 place-items-center rounded-full text-xs font-semibold transition-colors',
                current === d.id
                  ? 'bg-brand text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {d.id}
            </Link>
          ))}
          <Link
            to="/"
            title="The current live design"
            className="ml-1 rounded-full px-3 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Current
          </Link>
        </div>
      </div>
    </div>
  )
}

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'relative shrink-0 rounded-xl bg-gradient-to-br from-brand/20 to-primary/20 shadow-glow',
          size === 'lg' ? 'size-12' : 'size-10',
        )}
      >
        <Suspense fallback={null}>
          <Logo3D className="size-full" />
        </Suspense>
      </span>
      <span
        className={cn(
          'wordmark min-w-0 truncate leading-none font-semibold',
          size === 'lg' ? 'text-[1.75rem]' : 'text-[1.5rem]',
        )}
      >
        Agentra
      </span>
    </div>
  )
}

/** Accent only — see `usePinnedDarkMode` for why the light/dark toggle is
 * not offered inside the previews. */
export function ThemeControls() {
  return (
    <div className="flex items-center gap-2">
      <ThemeSelectorCompact size="lg" />
    </div>
  )
}

/** The one action every design needs. Same enter-btn recipe as the live page. */
export function EnterButton({
  label = 'Enter Workspace',
  className,
}: {
  label?: string
  className?: string
}) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate('/app')}
      className={cn(
        'enter-btn group inline-flex items-center gap-2.5 rounded-full px-8 py-3.5 text-base font-semibold text-primary-foreground',
        className,
      )}
    >
      {label}
      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
    </button>
  )
}
