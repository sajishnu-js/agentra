import { Environment, Sparkles } from '@react-three/drei'
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
  usePointer,
  useReveal,
  useFrame,
} from '@/scene/cinematic'
import { SpiralKnot } from '@/scene/SpiralKnot'
import { BrandMark, EnterButton, PreviewShell, ThemeControls } from './shared'

/**
 * VARIATION 2 — DIAMOND CORE
 *
 * The Agentra mark, brought back at scale and put where it belongs: inside
 * the spiral. The octahedron from the sidebar logo — same geometry, same
 * rotation, same accent-driven material — sits caught in the middle of the
 * coil, glowing, lighting the strand from within.
 *
 * The knot's tube is thinned so the gaps in the winding open up and the core
 * is genuinely glimpsed through them as it turns, rather than being walled
 * in. The core breathes on a slow pulse, and its light is a real point light
 * at the centre of the scene, so every highlight on the surrounding metal is
 * actually cast by the diamond.
 */

function Core({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]
  const mark = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.PointLight>(null)
  const halo = useRef<THREE.Mesh>(null)

  // Soft-edged sprite for the core's bloom. A flat disc gives a hard rim that
  // reads as a plate; painting the falloff into a texture is the cheapest way
  // to get a real soft edge.
  const glowTex = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.35, `${p.primary}aa`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  }, [p])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // The same motion as the sidebar mark, so it is recognisably the logo.
    if (mark.current) {
      mark.current.rotation.y = t * 0.6
      mark.current.rotation.x = Math.sin(t * 0.4) * 0.3
    }
    // Slow pulse — the core "charging".
    const pulse = 0.75 + Math.sin(t * 1.15) * 0.25
    if (glow.current) glow.current.intensity = 20 + pulse * 16
    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.3 + pulse * 0.16
      halo.current.scale.setScalar(1.9 + pulse * 0.25)
    }
  })

  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 9, 28]} />

      <ambientLight intensity={0.14} />
      {/* Rim lights only. The core is the key light in this scene. */}
      <spotLight position={[6, 5, 4]} angle={0.6} penumbra={1} intensity={55} color={p.secondary} />
      <spotLight position={[-6, -3, 3]} angle={0.6} penumbra={1} intensity={40} color={p.tertiary} />
      <Environment preset="city" environmentIntensity={0.22} />

      {/* Lifted well above centre: at scale, the coil and the copy were
          fighting for the same half of the frame. */}
      <group position={[0, 1.0, 0]}>
        {/* The diamond's own light. This is what makes the strand read as lit
            *from inside* the coil. */}
        <pointLight ref={glow} intensity={40} color={p.primary} distance={7} />

        {/* Soft bloom body behind the mark. */}
        <mesh ref={halo} position={[0, 0, -0.4]} scale={1.9}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={glowTex}
            transparent
            opacity={0.4}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* The mark itself — the sidebar's octahedron, at hero scale. */}
        <mesh ref={mark} scale={0.62}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={p.primary}
            metalness={0.85}
            roughness={0.15}
            emissive={p.primary}
            emissiveIntensity={1.2}
            toneMapped={false}
          />
        </mesh>

        {/* The spiral, opened up. tube 0.2 instead of 0.34 — at full thickness
            the winding closes over the middle and the core is simply hidden. */}
        <SpiralKnot pointer={pointer} scale={0.95} tube={0.18} spin={0.19}>
          <meshStandardMaterial
            color={p.tintLight}
            metalness={1}
            roughness={0.12}
            envMapIntensity={1.6}
          />
        </SpiralKnot>
      </group>

      <Sparkles count={90} scale={[7, 7, 6]} position={[0, 1, 0]} size={2} speed={0.2} opacity={0.4} color={p.tintLighter} />

      <CameraRig pointer={pointer} depth={0.7} look={new THREE.Vector3(0, 0.2, 0)} />
      <CinemaGrade bloom={1.0} radius={0.7} vignette={0.8} aberration={0.0008} />
    </>
  )
}

export function Var2DiamondCore() {
  const pointer = usePointer()
  const reveal = useReveal(150)

  return (
    <PreviewShell current={2} className="bg-black">
      <SceneShell camera={{ position: [0, 0.2, 7.2], fov: 42 }}>
        <Core pointer={pointer} />
      </SceneShell>

      <TextScrim shape="ellipse 54% 32% at 50% 82%" strength={0.8} />
      <SmokeLayer intensity={0.85} height="46vh" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 px-10 py-7" style={reveal(0)}>
          <BrandMark />
          <ThemeControls />
        </header>

        {/* Centred and low: the core owns the middle of the frame. */}
        <main className="flex flex-1 flex-col items-center justify-end px-6 pb-24 text-center">
          <p
            className="font-mono text-[10px] tracking-[0.42em] text-brand-text uppercase"
            style={reveal(1)}
          >
            One core · Every conversation
          </p>

          <h1
            className="font-display mt-6 text-[clamp(2.25rem,5vw,4rem)] leading-[0.98] font-semibold tracking-[-0.03em] text-balance"
            style={reveal(2)}
          >
            Everything you know,
            <br />
            <span
              className="bg-gradient-to-r from-brand-text via-brand to-brand-2 bg-clip-text text-transparent"
              style={{ filter: 'drop-shadow(0 0 44px color-mix(in oklab, var(--brand) 52%, transparent))' }}
            >
              wound into one system.
            </span>
          </h1>

          <p
            className="mt-6 max-w-lg text-base leading-relaxed text-balance text-muted-foreground"
            style={reveal(3)}
          >
            Agents, knowledge bases and workflows turning around a single core —
            on your infrastructure, answering in your voice.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4" style={reveal(4)}>
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
