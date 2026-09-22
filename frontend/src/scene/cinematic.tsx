/**
 * Cinematic toolkit for the landing hero.
 *
 * The pieces the hero scene needs that aren't the subject itself: pointer
 * tracking, an eased camera rig, the post-processing grade, a smoke bank
 * along the bottom edge, a legibility scrim, and the entrance reveal.
 *
 * Everything here is theme-aware. The hero is reachable before sign-in with
 * the light/dark toggle right there in the header, so "assume a black page"
 * is not an option — bloom, vignette and a black scrim all have to soften or
 * invert when the page is light, or the frame turns into mud.
 */
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { BlendFunction } from 'postprocessing'
import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { useTheme } from '@/theme/ThemeProvider'

/* ------------------------------------------------------------------ mouse */

/** Normalised pointer, -1..1 on both axes, plus a smoothed follower. Read
 *  inside a frame loop so the camera lags behind the cursor instead of
 *  snapping — that lag is most of what makes parallax feel expensive rather
 *  than twitchy. */
export type Pointer = React.RefObject<{ x: number; y: number; sx: number; sy: number }>

export function usePointer(): Pointer {
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 })
  useEffect(() => {
    function onMove(e: PointerEvent) {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  return pointer
}

/** Eases the camera toward the pointer every frame. `depth` controls how far
 *  it travels; `look` keeps it aimed at the subject. */
export function CameraRig({
  pointer,
  depth = 0.45,
  look = new THREE.Vector3(0, 0, 0),
  ease = 0.035,
}: {
  pointer: Pointer
  depth?: number
  look?: THREE.Vector3
  ease?: number
}) {
  const { camera } = useThree()
  const base = useRef(camera.position.clone())
  useFrame(() => {
    const p = pointer.current
    p.sx += (p.x - p.sx) * ease
    p.sy += (p.y - p.sy) * ease
    camera.position.x = base.current.x + p.sx * depth
    camera.position.y = base.current.y - p.sy * depth * 0.6
    camera.lookAt(look)
  })
  return null
}

/* ------------------------------------------------------------ background */

/**
 * The page's own resolved background colour, as a hex THREE can use.
 *
 * Read off the live computed style rather than hard-coded per theme: the app
 * ships seven accents across two modes, and `getComputedStyle` resolves
 * whichever is actually applied — including the oklch() custom properties,
 * which THREE.Color cannot parse but the browser has already flattened to
 * rgb() by the time it reaches us. Used for fog, so the scene fades into the
 * page instead of into an assumed black.
 */
function readPageBackground(fallbackDark: boolean): string {
  try {
    const rgb = getComputedStyle(document.body).backgroundColor
    // A body with no painted background computes to fully transparent, which
    // setStyle would silently turn into black — on a light page that paints
    // the hero black behind a white document.
    if (rgb && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(rgb)) {
      return '#' + new THREE.Color().setStyle(rgb).getHexString()
    }
  } catch {
    /* fall through */
  }
  return fallbackDark ? '#05070a' : '#ffffff'
}

export function usePageBackground(): string {
  const { theme, accent } = useTheme()
  const [hex, setHex] = useState(() =>
    readPageBackground(document.documentElement.classList.contains('dark')),
  )
  useEffect(() => {
    // Deferred a frame: the theme class lands in an effect of its own, so
    // reading synchronously here can catch the previous mode's colour.
    const id = requestAnimationFrame(() => setHex(readPageBackground(theme === 'dark')))
    return () => cancelAnimationFrame(id)
  }, [theme, accent])
  return hex
}

/* ------------------------------------------------------------- post stack */

/** The cinematic grade. Bloom does the heavy lifting; the vignette pulls
 *  focus to centre; a trace of chromatic aberration reads as a real lens.
 *  All three are dialled right back in light mode, where bloom on a bright
 *  page just washes the type out and a dark vignette looks like a smudge. */
export function CinemaGrade({
  bloom = 1.1,
  radius = 0.8,
  aberration = 0.0006,
  vignette = 0.6,
}: {
  bloom?: number
  radius?: number
  aberration?: number
  vignette?: number
}) {
  const { theme } = useTheme()
  const light = theme === 'light'
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={light ? bloom * 0.4 : bloom}
        radius={radius}
        luminanceThreshold={light ? 0.65 : 0.2}
        luminanceSmoothing={0.5}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new THREE.Vector2(aberration, aberration)}
        blendFunction={BlendFunction.NORMAL}
        radialModulation
        modulationOffset={0.4}
      />
      <Vignette eskil={false} offset={0.25} darkness={light ? vignette * 0.3 : vignette} />
    </EffectComposer>
  )
}

/* ------------------------------------------------------------------ smoke */

/**
 * Smoke banked along the bottom of the viewport.
 *
 * Deliberately DOM/CSS rather than a particle system: layered radial
 * gradients on very slow, offset drift animations give the same rolling fog
 * for a fraction of the cost, composite over the WebGL canvas without
 * fighting it for depth, and cannot tank the frame rate on an integrated GPU
 * the way a real volumetric pass can.
 */
export function SmokeLayer({
  intensity = 1,
  height = '46vh',
  className = '',
}: {
  intensity?: number
  height?: string
  className?: string
}) {
  const { theme } = useTheme()
  // Light mode gets a fraction of it. The same gradients that read as haze
  // over black read as dirt over a pale page.
  const k = intensity * (theme === 'light' ? 0.4 : 1)
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-[1] overflow-hidden ${className}`}
      style={{ height }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="smoke-drift absolute rounded-full"
          style={{
            // Wider than the viewport so the horizontal drift never exposes
            // an edge as the layer slides.
            width: '160%',
            height: '150%',
            left: `${-30 + i * 12}%`,
            bottom: `${-70 + i * 8}%`,
            background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${
              i % 2
                ? 'color-mix(in oklab, var(--brand-2) 26%, transparent)'
                : 'color-mix(in oklab, var(--brand) 30%, transparent)'
            } 0%, transparent 68%)`,
            filter: `blur(${52 + i * 16}px)`,
            opacity: (0.5 - i * 0.07) * k,
            animationDuration: `${26 + i * 9}s`,
            animationDelay: `${i * -6}s`,
            animationDirection: i % 2 ? 'reverse' : 'normal',
          }}
        />
      ))}
      {/* A brighter ground haze right at the base — the "stage fog catching
          the key light" note that keeps the bank from reading as a flat wash. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/3"
        style={{
          background:
            'linear-gradient(to top, color-mix(in oklab, var(--brand) 22%, transparent), transparent)',
          filter: 'blur(30px)',
          opacity: theme === 'light' ? 0.4 : 1,
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ scrim */

/**
 * A soft pool behind text that sits over a busy part of the scene.
 *
 * Cinematography's own answer to this: you do not dim the set, you flag the
 * light falling where the subject needs to read. A radial gradient with no
 * hard edge is invisible as a shape but buys back the contrast the copy
 * needs. Inverts to white in light mode — a black scrim on a pale page is a
 * grey smear, and makes the contrast worse rather than better.
 */
export function TextScrim({
  className = '',
  strength = 0.7,
  shape = 'ellipse 58% 52% at 50% 50%',
}: {
  className?: string
  strength?: number
  shape?: string
}) {
  const { theme } = useTheme()
  const tint = theme === 'light' ? '255 255 255' : '0 0 0'
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-[1] ${className}`}
      style={{
        background: `radial-gradient(${shape}, rgb(${tint} / ${strength}) 0%, transparent 72%)`,
      }}
    />
  )
}

/* -------------------------------------------------------------- entrance */

/** Staggered reveal. Returns a style object per index — content rises and
 *  un-blurs in sequence, the way an Apple hero settles rather than popping. */
export function useReveal(delayMs = 120) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), 60)
    return () => window.clearTimeout(id)
  }, [])
  return (i: number): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transform: on ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.985)',
    filter: on ? 'blur(0px)' : 'blur(6px)',
    transition: `opacity 1s cubic-bezier(.16,1,.3,1) ${i * delayMs}ms,
                 transform 1.1s cubic-bezier(.16,1,.3,1) ${i * delayMs}ms,
                 filter 1s cubic-bezier(.16,1,.3,1) ${i * delayMs}ms`,
  })
}

/** Layer-level parallax for DOM content, driven by the same pointer. */
export function useDomParallax(strength = 12) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const target = { x: 0, y: 0 }
    const cur = { x: 0, y: 0 }
    function onMove(e: PointerEvent) {
      target.x = ((e.clientX / window.innerWidth) * 2 - 1) * strength
      target.y = ((e.clientY / window.innerHeight) * 2 - 1) * strength
    }
    function loop() {
      cur.x += (target.x - cur.x) * 0.06
      cur.y += (target.y - cur.y) * 0.06
      if (ref.current) {
        ref.current.style.transform = `translate3d(${-cur.x}px, ${-cur.y}px, 0)`
      }
      raf = requestAnimationFrame(loop)
    }
    window.addEventListener('pointermove', onMove)
    raf = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [strength])
  return ref
}

/* ------------------------------------------------------------ scene shell */

/**
 * Full-bleed canvas behind the content.
 *
 * `alpha: true` and no scene background: the canvas composites over the
 * page's own `--background`, so the hero follows the theme for free instead
 * of painting its own black over a light page.
 */
export function SceneShell({
  children,
  camera = { position: [0, 0, 6] as [number, number, number], fov: 42 },
  className = '',
}: {
  children: React.ReactNode
  camera?: { position: [number, number, number]; fov?: number }
  className?: string
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 z-0 ${className}`}>
      <Canvas
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.75]}
        camera={camera}
      >
        {/* This boundary is load-bearing, not decoration. `Environment`
            fetches an HDRI and suspends while it does. Without a boundary
            *inside* the Canvas, that suspension propagates to whichever
            Suspense wraps the lazily-imported scene on the page — which
            tears down the Canvas itself mid-mount and drops the WebGL
            context, leaving a permanently blank hero. Caught here, the
            renderer stays up and only the scene contents wait. */}
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  )
}

// Re-exported so scene files import from one module.
export { useFrame, useThree, THREE }
