import { Environment, MeshReflectorMaterial, Sparkles } from '@react-three/drei'
import { useRef } from 'react'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'
import {
  CameraRig,
  CinemaGrade,
  SceneShell,
  SmokeLayer,
  TextScrim,
  THREE,
  usePointer,
  useReveal,
  useFrame,
} from '@/scene/cinematic'
import { SpiralKnot } from '@/scene/SpiralKnot'
import { BrandMark, EnterButton, PreviewShell, ThemeControls } from './shared'

/**
 * VARIATION 4 — PRISM HALL
 *
 * The spiral rendered in iridescent metal, standing on a black mirror in a
 * hall of light beams.
 *
 * The surface uses thin-film iridescence — the same physics as oil on water
 * or a soap bubble — so the colour on the strand shifts continuously with
 * viewing angle. Turn the coil and it runs through the whole spectrum, which
 * a plain chrome material cannot do at any cost. Crucially it is *not*
 * transmission: refraction would mean re-rendering the scene into a buffer
 * every frame, which on this geometry cost roughly two thirds of the frame
 * budget for an effect that barely reads against black.
 *
 * Beneath it, a genuine reflection pass — the coil arrives with its own
 * inverted twin, and the type sits over the reflection.
 */

function Prism({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]
  const beams = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (beams.current) beams.current.rotation.y = t * 0.06
  })

  return (
    <>
      <color attach="background" args={['#000000']} />
      {/* Tight, so the mirror plane falls to black well inside its own edge
          and never draws a horizon line across the frame. */}
      <fog attach="fog" args={['#000000', 7, 20]} />

      <ambientLight intensity={0.22} />
      <spotLight position={[5, 6, 4]} angle={0.55} penumbra={1} intensity={130} color={p.primary} />
      <spotLight position={[-6, 3, 3]} angle={0.6} penumbra={1} intensity={95} color={p.secondary} />
      <pointLight position={[0, 3.5, 2.5]} intensity={45} color={p.tintLighter} />
      {/* Iridescence is an interference effect on top of reflected light — it
          needs a real environment to interfere *with*, or the strand renders
          as flat tinted metal with no colour travel at all. */}
      <Environment preset="city" environmentIntensity={0.6} />

      <SpiralKnot pointer={pointer} position={[0, 1.55, 0]} scale={0.8} spin={0.14}>
        <meshPhysicalMaterial
          color={p.primaryDark}
          metalness={0.95}
          roughness={0.14}
          envMapIntensity={1.9}
          iridescence={1}
          iridescenceIOR={1.9}
          iridescenceThicknessRange={[120, 780]}
        />
      </SpiralKnot>

      {/* Dust turning slowly through the hall. An earlier pass put standing
          light columns here — open-ended cylinders — and side-on they render
          as flat vertical bars with hard edges, which read as scenery flats
          rather than as light. Suspended particles catch the key lights and
          give the room depth without drawing anything with an outline. */}
      <group ref={beams}>
        <Sparkles count={140} scale={[11, 7, 8]} position={[0, 1.2, 0]} size={2.6} speed={0.14} opacity={0.5} color={p.tintLighter} />
      </group>

      {/* The mirror. Two settings carry it:
          - `envMapIntensity={0}` — left on, the floor also reflects the bright
            city HDRI and the whole bottom of the frame becomes a grey haze.
          - `mixStrength` low — it multiplies the reflection, and at 12 even a
            nearly black reflected scene came back as a bright grey sheet with
            a hard horizon line drawn across the frame. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={512}
          mixBlur={0.75}
          mixStrength={2.5}
          blur={[200, 60]}
          mirror={0.9}
          depthScale={1.3}
          minDepthThreshold={0.25}
          maxDepthThreshold={1.2}
          color="#000000"
          metalness={0}
          roughness={1}
          envMapIntensity={0}
        />
      </mesh>

      <CameraRig pointer={pointer} depth={0.75} look={new THREE.Vector3(0, 1.5, 0)} />
      <CinemaGrade bloom={1.15} radius={0.85} vignette={0.74} aberration={0.0014} />
    </>
  )
}

export function Var4PrismHall() {
  const pointer = usePointer()
  const reveal = useReveal(150)

  return (
    <PreviewShell current={4} className="bg-black">
      <SceneShell camera={{ position: [0, 0.55, 6.6], fov: 42 }}>
        <Prism pointer={pointer} />
      </SceneShell>

      {/* The copy sits over the reflection, so it needs a real pool of
          darkness under it rather than a light dimming. */}
      <TextScrim shape="ellipse 56% 34% at 50% 80%" strength={0.84} />
      <SmokeLayer intensity={0.9} height="48vh" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 px-10 py-7" style={reveal(0)}>
          <BrandMark />
          <ThemeControls />
        </header>

        <main className="flex flex-1 flex-col items-center justify-end px-6 pb-24 text-center">
          <h1
            className="font-display text-[clamp(2.25rem,4.9vw,3.95rem)] leading-[0.98] font-semibold tracking-[-0.03em] text-balance"
            style={reveal(1)}
          >
            Support that
            <br />
            <span
              className="bg-gradient-to-r from-brand-text via-brand to-brand-2 bg-clip-text text-transparent"
              style={{ filter: 'drop-shadow(0 0 46px color-mix(in oklab, var(--brand) 52%, transparent))' }}
            >
              never loses the thread.
            </span>
          </h1>

          <p
            className="mt-6 max-w-lg text-base leading-relaxed text-balance text-muted-foreground"
            style={reveal(2)}
          >
            Five specialists, each grounded in its own knowledge base, handing
            over to a person the moment certainty runs out.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4" style={reveal(3)}>
            <EnterButton />
            <span className="text-[11px] tracking-[0.18em] text-foreground-subtle uppercase">
              No sign-in required
            </span>
          </div>
        </main>
      </div>
    </PreviewShell>
  )
}
