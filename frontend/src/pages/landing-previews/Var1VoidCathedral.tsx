import { Environment, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom, GodRays, Vignette } from '@react-three/postprocessing'
import { useState } from 'react'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'
import {
  CameraRig,
  SceneShell,
  SmokeLayer,
  TextScrim,
  THREE,
  useDomParallax,
  usePointer,
  useReveal,
} from '@/scene/cinematic'
import { SpiralKnot } from '@/scene/SpiralKnot'
import { BrandMark, EnterButton, PreviewShell, ThemeControls } from './shared'

/**
 * VARIATION 1 — VOID CATHEDRAL
 *
 * The spiral standing in front of a single blinding light source, in a room
 * full of fog. A real god-rays pass traces the light that the coil blocks, so
 * the shadow it casts is drawn in volumetric shafts radiating out past it —
 * the beams move as the knot turns, because they *are* the knot's occlusion.
 * Dust hangs in the light.
 *
 * The most restrained of the four and the most purely cinematic: one light,
 * one object, and the air between them.
 */

function Cathedral({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]
  // GodRays needs the actual mesh instance, not a ref object — a callback ref
  // in state is the standard way to hand it over once mounted.
  const [sun, setSun] = useState<THREE.Mesh | null>(null)

  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 8, 26]} />

      <ambientLight intensity={0.18} />
      <spotLight position={[6, 6, 5]} angle={0.55} penumbra={1} intensity={90} color={p.primary} />
      <spotLight position={[-7, -2, 4]} angle={0.6} penumbra={1} intensity={70} color={p.secondary} />
      <Environment preset="city" environmentIntensity={0.45} />

      {/* The source. Sits behind the spiral so the coil eclipses it — that
          occlusion is what the god-rays pass turns into shafts. Small and
          far back on purpose: god rays radiate *from* the source, so a large
          near one just fills the middle of the frame with white and there is
          no room left to see the shafts it is supposed to be throwing. */}
      <mesh ref={setSun} position={[2.15, 0.1, -6.5]}>
        <sphereGeometry args={[0.38, 32, 32]} />
        <meshBasicMaterial color={p.tintLighter} toneMapped={false} />
      </mesh>

      <SpiralKnot pointer={pointer} position={[2.15, 0, 0]} scale={1.18}>
        {/* Polished metal, as in the design you picked. Deliberately dark
            enough that it silhouettes cleanly against the source. */}
        <meshStandardMaterial
          color={p.tintLight}
          metalness={1}
          roughness={0.09}
          envMapIntensity={1.8}
        />
      </SpiralKnot>

      {/* Dust in the beams. Without something suspended in it, volumetric
          light has nothing to land on and reads as a flat gradient. */}
      <Sparkles count={120} scale={[9, 7, 6]} position={[2.15, 0, -1]} size={2.2} speed={0.16} opacity={0.45} color={p.tintLighter} />

      <CameraRig pointer={pointer} depth={0.85} />

      {/* Bespoke stack rather than the shared CinemaGrade: god rays have to
          run before bloom, or the bloom blows out the source and there is
          nothing left with a clean edge for the rays to radiate from. */}
      <EffectComposer multisampling={0}>
        {sun ? (
          <GodRays
            sun={sun}
            density={0.97}
            decay={0.95}
            weight={0.7}
            exposure={0.28}
            samples={70}
            clampMax={0.92}
            blur
          />
        ) : (
          <></>
        )}
        <Bloom intensity={1.1} radius={0.85} luminanceThreshold={0.2} luminanceSmoothing={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.22} darkness={0.78} />
      </EffectComposer>
    </>
  )
}

export function Var1VoidCathedral() {
  const pointer = usePointer()
  const reveal = useReveal(140)
  const parallax = useDomParallax(16)

  return (
    <PreviewShell current={1} className="bg-black">
      <SceneShell camera={{ position: [0, 0, 6.2], fov: 40 }}>
        <Cathedral pointer={pointer} />
      </SceneShell>

      <TextScrim shape="ellipse 46% 70% at 22% 50%" strength={0.82} />
      <SmokeLayer intensity={1.3} height="54vh" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 px-10 py-7" style={reveal(0)}>
          <BrandMark />
          <ThemeControls />
        </header>

        <main className="flex flex-1 items-center px-10 pb-32">
          <div ref={parallax} className="max-w-2xl">
            <span className="pill pill-brand" style={reveal(1)}>
              <span className="pill-dot" aria-hidden />
              Self-hosted AI customer support
            </span>

            <h1
              className="font-display mt-7 text-[clamp(3rem,7vw,6rem)] leading-[0.9] font-semibold tracking-[-0.03em]"
              style={reveal(2)}
            >
              Answers,
              <br />
              <span
                className="bg-gradient-to-br from-brand-text via-brand to-brand-2 bg-clip-text text-transparent"
                style={{ filter: 'drop-shadow(0 0 42px color-mix(in oklab, var(--brand) 55%, transparent))' }}
              >
                forged from
                <br />
                your knowledge.
              </span>
            </h1>

            <p className="mt-8 max-w-lg text-base leading-relaxed text-muted-foreground" style={reveal(3)}>
              Every reply grounded in your own documents, every source cited, and
              a person brought in the moment it isn’t certain.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4" style={reveal(4)}>
              <EnterButton />
              <span className="text-[11px] tracking-wide text-foreground-subtle uppercase">
                No sign-in required
              </span>
            </div>
          </div>
        </main>
      </div>
    </PreviewShell>
  )
}
