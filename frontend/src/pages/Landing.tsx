import { ArrowRight, BarChart3, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { BrandMark } from '@/components/layout/BrandMark'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { ThemeSelectorCompact } from '@/components/ThemeSelector'
import { useTilt } from '@/hooks/useTilt'
import { cn } from '@/lib/utils'
import { SmokeLayer, TextScrim, useDomParallax, usePointer, useReveal } from '@/scene/cinematic'
import { useSpinBoost } from '@/scene/SpiralKnot'

// Lazily loaded so the three.js chunk doesn't block first paint. It is the
// same chunk the dashboard's AppShell uses, so the download this triggers is
// warm by the time "Enter Workspace" is clicked.
const SpiralHero = lazy(() => import('@/scene/SpiralHero').then((m) => ({ default: m.SpiralHero })))

const features: { icon: typeof Zap; label: string }[] = [
  { icon: Zap, label: 'Grounded AI replies' },
  { icon: ShieldCheck, label: 'Smart human handoff' },
  { icon: BarChart3, label: 'Live analytics' },
]

/** The transition-out duration, in ms — kept as one constant so the CSS
 * (`duration-500`) and the navigation delay below can never drift apart. */
const EXIT_MS = 520

export function Landing() {
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const [exiting, setExiting] = useState(false)
  const tilt = useTilt<HTMLButtonElement>(7)

  // Shared with the WebGL scene. Both are refs, so pointer movement and CTA
  // hover drive the animation without re-rendering this component.
  const pointer = usePointer()
  const boost = useSpinBoost()

  const reveal = useReveal(110)
  const parallax = useDomParallax(14)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleEnter() {
    setExiting(true)
    window.setTimeout(() => navigate('/app'), EXIT_MS)
  }

  return (
    // overflow-y-auto, not hidden: this page's content can run taller than a
    // short browser window (address bar + bookmarks bar eating into viewport
    // height, a laptop at less than full height). `overflow-hidden` silently
    // clipped the CTA off the bottom in that case with no way to reach it.
    <div className="relative flex h-full min-h-screen w-full flex-col overflow-x-hidden overflow-y-auto">
      <Suspense fallback={null}>
        <SpiralHero pointer={pointer} boost={boost} />
      </Suspense>

      {/* Pools of page colour behind the copy. The spiral sits to the right on
          wide screens and above the copy when stacked, so the scrim is placed
          to cover whichever side the text is actually on at that width. */}
      <TextScrim
        className="hidden lg:block"
        shape="ellipse 44% 66% at 24% 50%"
        strength={0.78}
      />
      <TextScrim className="lg:hidden" shape="ellipse 72% 40% at 50% 72%" strength={0.7} />
      <SmokeLayer intensity={1.15} height="52vh" />

      <header className="relative z-10 flex items-center justify-between gap-3 p-5">
        {/* Brand mark, top-left — the same component the sidebar renders. */}
        <BrandMark size="lg" style={reveal(0)} />

        {/* Light/dark and the theme picker both stay reachable before
            entering the workspace, matching how the dashboard's Topbar pairs
            them. The spiral's x position is clamped against the live viewport
            in SpiralHero, so it can never drift under these controls. */}
        <div className="flex items-center gap-2" style={reveal(1)}>
          <ThemeSelectorCompact size="lg" />
          <ThemeToggle />
        </div>
      </header>

      <main
        className={cn(
          'relative z-10 flex flex-1 items-center px-6 py-8 transition-all ease-out sm:px-10',
          exiting
            ? 'duration-500 scale-105 opacity-0 blur-sm'
            : mounted
              ? 'duration-700 scale-100 opacity-100'
              : 'duration-700 scale-[0.99] opacity-0',
        )}
      >
        {/* Desktop: the copy takes the left 46% and the spiral is centred in
            what remains, so the two can never collide. Stacked: full width,
            centred, and pushed below the band the spiral is pinned into (it
            occupies the top 4–34%, see useLayout in SpiralHero). */}
        <div
          ref={parallax}
          className="mx-auto w-full max-w-xl pt-[36vh] text-center lg:mx-0 lg:max-w-[46%] lg:pt-0 lg:text-left"
        >
          <span className="pill pill-brand float-slow" style={reveal(2)}>
            <span className="pill-dot" aria-hidden />
            AI-Powered Business Automation Platform
          </span>

          {/* Orbitron. Sized a step down from the old Space Grotesk setting
              and given positive tracking — it is a much wider design, so the
              same size and negative tracking overflowed the column and
              closed the letterforms up. */}
          <h1
            className="font-brand mt-5 text-[2.6rem] leading-[0.95] font-bold tracking-[0.02em] sm:text-[4.25rem]"
            style={reveal(3)}
          >
            <span
              className="bg-gradient-to-r from-brand-text via-brand to-brand-2 bg-clip-text text-transparent"
              style={{
                filter: 'drop-shadow(0 0 40px color-mix(in oklab, var(--brand) 42%, transparent))',
              }}
            >
              Agentra
            </span>
          </h1>

          {/* Syne — the lede. Full foreground colour and real weight, so it
              reads as a statement rather than as a subtitle. */}
          <p
            className="font-statement mt-6 text-[clamp(1.2rem,1.9vw,1.7rem)] leading-[1.18] font-bold tracking-[-0.015em] text-balance"
            style={reveal(4)}
          >
            Enter the Next Era of Business Intelligence.
          </p>

          {/* Manrope — deliberately quieter, and a different family again so
              the two lines never read as one block set at two sizes. */}
          <p
            className="font-detail mt-4 text-sm leading-relaxed text-balance text-muted-foreground sm:text-base"
            style={reveal(5)}
          >
            {/* Non-breaking spaces inside the two verb phrases: balanced
                wrapping otherwise split "workflows / move", which reads as a
                noun stranded from its verb. */}
            A unified AI workspace where agents{'\u00A0'}think, workflows{'\u00A0'}move,
            and your business stays one step ahead.
          </p>

          <div
            className="mt-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start"
            style={reveal(6)}
          >
            {features.map(({ icon: Icon, label }, i) => (
              <span
                key={label}
                className="pill pill-muted float-slow"
                style={{ '--float-delay': `${i * 0.6}s` } as React.CSSProperties}
              >
                <Icon className="size-3" />
                {label}
              </span>
            ))}
          </div>

          <div
            className="mt-8 flex flex-col items-center gap-4 lg:flex-row lg:items-center"
            style={reveal(7)}
          >
            <button
              ref={tilt.ref}
              onMouseMove={tilt.onMouseMove}
              onMouseLeave={() => {
                tilt.onMouseLeave()
                boost.current.target = 0
              }}
              onMouseEnter={() => {
                boost.current.target = 1
              }}
              // Keyboard and touch reach the same behaviour: focusing or
              // touching the CTA spins the spiral up too, so the interaction
              // is not mouse-only.
              onFocus={() => {
                boost.current.target = 1
              }}
              onBlur={() => {
                boost.current.target = 0
              }}
              onTouchStart={() => {
                boost.current.target = 1
              }}
              onTouchEnd={() => {
                boost.current.target = 0
              }}
              onClick={handleEnter}
              className="tilt-3d enter-btn group inline-flex items-center gap-2.5 rounded-full px-8 py-3.5 text-base font-semibold text-primary-foreground"
            >
              Enter Workspace
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>

            <p className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
              <Sparkles className="size-3" />
              No sign-in required — jump straight into the dashboard
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
