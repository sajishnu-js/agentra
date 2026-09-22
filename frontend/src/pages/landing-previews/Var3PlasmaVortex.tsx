import { Environment } from '@react-three/drei'
import { useMemo, useRef } from 'react'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'
import {
  CameraRig,
  CinemaGrade,
  SceneShell,
  SmokeLayer,
  TextScrim,
  THREE,
  useDomParallax,
  usePointer,
  useReveal,
  useFrame,
} from '@/scene/cinematic'
import { SpiralKnot } from '@/scene/SpiralKnot'
import { BrandMark, EnterButton, PreviewShell, ThemeControls } from './shared'

/**
 * VARIATION 3 — PLASMA VORTEX
 *
 * The spiral as an attractor. 14,000 points fall toward it along inclined
 * circular orbits — every particle on its own tilted plane, so the swarm is a
 * sphere of intersecting rings rather than a flat disc, and it spins up as it
 * gets closer. Anything that reaches the coil is recycled back out to the rim,
 * so the stream never runs dry.
 *
 * Orbital speed goes as 1/r: the inner shell visibly races while the outer
 * one drifts, which is what stops the whole thing from turning as one rigid
 * ball. The knot itself glows from within rather than reflecting — here it is
 * the energy source, not a mirror.
 */

const COUNT = 9000
/** Held clear of the coil's own extent (~1.6 at this scale). Any smaller and
 *  particles orbit *through* the strand, which reads as speckle crawling over
 *  its surface rather than as a swarm circling it. */
const R_MIN = 2.3
/** Deliberately not much wider than the coil. Spread over a large radius the
 *  swarm thins out to an even scatter across the whole frame and reads as a
 *  static starfield — the sense of things *falling in* only survives while
 *  the cloud is visibly denser near the middle than at its edge. */
const R_MAX = 4.3

function Vortex({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]
  const points = useRef<THREE.Points>(null)
  const swarm = useRef<THREE.Group>(null)

  const { positions, orbits, colors } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    // radius, phase, inclination, inward drift rate — packed per point.
    const orbits = new Float32Array(COUNT * 4)
    const colors = new Float32Array(COUNT * 3)

    const hot = new THREE.Color(p.tintLighter)
    const mid = new THREE.Color(p.primary)
    const cool = new THREE.Color(p.secondary)

    for (let i = 0; i < COUNT; i++) {
      // Squared, so density piles up toward the inner shell. A flat random
      // radius distributes evenly through the *volume*, which means most
      // particles end up out at the rim where they do nothing.
      const r = R_MIN + Math.random() ** 2 * (R_MAX - R_MIN)
      orbits[i * 4] = r
      orbits[i * 4 + 1] = Math.random() * Math.PI * 2
      orbits[i * 4 + 2] = Math.random() * Math.PI // orbital plane tilt
      orbits[i * 4 + 3] = 0.1 + Math.random() * 0.28 // how fast it falls in

      const f = (r - R_MIN) / (R_MAX - R_MIN)
      const col = f < 0.25 ? hot : f < 0.68 ? mid : cool
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
    return { positions, orbits, colors }
  }, [p])

  useFrame((state, delta) => {
    const mesh = points.current
    if (!mesh) return
    const t = state.clock.elapsedTime
    const arr = mesh.geometry.attributes.position.array as Float32Array
    // Clamped: a background tab can hand back a delta of several seconds, and
    // every particle would teleport to the core on the first frame back.
    const dt = Math.min(delta, 0.05)

    for (let i = 0; i < COUNT; i++) {
      const o = i * 4
      let r = orbits[o] - orbits[o + 3] * dt
      // Recycle to the rim, with a fresh plane so the stream never develops
      // visible repeating lanes.
      if (r < R_MIN) {
        r = R_MIN + Math.random() ** 0.5 * (R_MAX - R_MIN)
        orbits[o + 1] = Math.random() * Math.PI * 2
        orbits[o + 2] = Math.random() * Math.PI
      }
      orbits[o] = r

      // Angular speed ~ 1/r, so the swarm shears instead of rotating rigidly.
      const a = orbits[o + 1] + (t * 1.6) / r
      const inc = orbits[o + 2]
      const ca = Math.cos(a)
      const sa = Math.sin(a)

      // A circular orbit of radius r, tilted by `inc` about the x axis.
      arr[i * 3] = ca * r
      arr[i * 3 + 1] = sa * Math.sin(inc) * r
      arr[i * 3 + 2] = sa * Math.cos(inc) * r
    }
    mesh.geometry.attributes.position.needsUpdate = true

    if (swarm.current) {
      swarm.current.rotation.y = t * 0.05 + pointer.current.sx * 0.3
      swarm.current.rotation.x = -pointer.current.sy * 0.2
    }
  })

  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 8, 22]} />

      <ambientLight intensity={0.1} />
      <pointLight position={[0, 0, 0]} intensity={30} color={p.primary} distance={8} />
      <spotLight position={[-6, 4, 5]} angle={0.6} penumbra={1} intensity={70} color={p.secondary} />
      {/* Key. Gives the strand a lit side and a dark side. */}
      <spotLight position={[3, 5, 6]} angle={0.7} penumbra={1} intensity={150} color={p.tintLight} />
      <Environment preset="night" environmentIntensity={0.7} />

      <group ref={swarm} position={[-2.1, 0, 0]}>
        {/* depthWrite off so the points blend into light where they crowd;
            depthTest stays on so the knot genuinely occludes the ones behind
            it and the coil sits *inside* the swarm rather than over it. */}
        <points ref={points}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          </bufferGeometry>
          {/* Larger than it looks like it needs to be. Below roughly this
              size the further points fall under a pixel, alias badly, and the
              swarm turns into red/green RGB static instead of light. */}
          <pointsMaterial
            size={0.032}
            vertexColors
            transparent
            opacity={0.72}
            sizeAttenuation
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>

        <SpiralKnot pointer={pointer} scale={1.15} tube={0.3} spin={0.24}>
          {/* Emissive rather than mirrored: in this scene the spiral is the
              thing everything else is falling into, so it has to be the
              brightest object, not a reflector of other light. */}
          {/* Not fully metallic. Metal has no diffuse term, so against a
              dark environment a mostly-emissive metal strand renders as one
              flat silhouette with no shading across the tube — the coil
              stops reading as a 3D form at all. Dropping metalness lets real
              light-and-shade return. */}
          <meshStandardMaterial
            color={p.primaryDark}
            metalness={0.55}
            roughness={0.32}
            emissive={p.primary}
            emissiveIntensity={0.15}
            envMapIntensity={1.4}
          />
        </SpiralKnot>
      </group>

      <CameraRig pointer={pointer} depth={0.65} look={new THREE.Vector3(-1.5, 0, 0)} />
      <CinemaGrade bloom={1.05} radius={0.85} vignette={0.82} aberration={0.0005} />
    </>
  )
}

export function Var3PlasmaVortex() {
  const pointer = usePointer()
  const reveal = useReveal(150)
  const parallax = useDomParallax(14)

  return (
    <PreviewShell current={3} className="bg-black">
      <SceneShell camera={{ position: [0, 0.2, 8.4], fov: 44 }}>
        <Vortex pointer={pointer} />
      </SceneShell>

      <TextScrim shape="ellipse 44% 62% at 76% 50%" strength={0.76} />
      <SmokeLayer intensity={1.2} height="52vh" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 px-10 py-7" style={reveal(0)}>
          <BrandMark />
          <ThemeControls />
        </header>

        <main className="flex flex-1 items-center justify-end px-10 pb-28">
          <div ref={parallax} className="max-w-xl">
            <span className="pill pill-brand backdrop-blur-md" style={reveal(1)}>
              <span className="pill-dot" aria-hidden />
              Self-hosted AI customer support
            </span>

            <h1
              className="font-display mt-7 text-[clamp(2.5rem,5.6vw,4.75rem)] leading-[0.94] font-semibold tracking-[-0.03em]"
              style={reveal(2)}
            >
              Every channel,
              <br />
              <span
                className="bg-gradient-to-r from-brand-text via-brand to-brand-2 bg-clip-text text-transparent"
                style={{ filter: 'drop-shadow(0 0 44px color-mix(in oklab, var(--brand) 52%, transparent))' }}
              >
                drawn into one.
              </span>
            </h1>

            <p className="mt-8 max-w-md text-base leading-relaxed text-muted-foreground" style={reveal(3)}>
              WhatsApp, Telegram, email and web arriving in a single stream —
              answered from your own knowledge, escalated the moment it matters.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4" style={reveal(4)}>
              <EnterButton />
              <span className="text-[11px] tracking-[0.18em] text-foreground-subtle uppercase">
                No sign-in required
              </span>
            </div>
          </div>
        </main>
      </div>
    </PreviewShell>
  )
}
