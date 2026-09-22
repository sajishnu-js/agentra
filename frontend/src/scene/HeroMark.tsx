import { Sparkles } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { scenePalettes, type ScenePalette } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * The landing page's centerpiece — a larger, slower rendition of the
 * sidebar's diamond mark (see Logo3D.tsx): a glossy gem core with an
 * additive-blended glow halo, a counter-rotating wireframe shell for a
 * "hologram" read, four orbiting rings, and a sparkle field. All hand-lit
 * (no environment map / HDRI fetch — see AmbientScene's history with that)
 * and no postprocessing package: the halo is a bigger, additive-blended,
 * transparent sphere behind the core, which is the cheap way to fake bloom.
 *
 * Every material colour comes from the active accent's ScenePalette (see
 * theme/accentPalettes.ts) rather than a literal hex, so switching themes
 * re-tints this in place — react-three-fiber calls .set() on each
 * material's THREE.Color when the prop changes, no remount needed.
 */

function Core({ p }: { p: ScenePalette }) {
  const ref = useRef<THREE.Mesh>(null)
  const shell = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (ref.current) {
      ref.current.rotation.y = t * 0.35
      ref.current.rotation.x = Math.sin(t * 0.25) * 0.25
      const breathe = 1 + Math.sin(t * 1.4) * 0.035
      ref.current.scale.setScalar(breathe)
    }
    if (shell.current) {
      shell.current.rotation.y = -t * 0.22
      shell.current.rotation.z = t * 0.12
    }
    if (halo.current) {
      const pulse = 1 + Math.sin(t * 1.4) * 0.06
      halo.current.scale.setScalar(pulse)
    }
  })

  return (
    <group>
      {/* Glow halo — additive blending fakes bloom without a postprocess pass. */}
      <mesh ref={halo} scale={2.1}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color={p.primary}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Hologram shell — counter-rotating wireframe, reads as a tech scan. */}
      <mesh ref={shell} scale={1.75}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={p.secondary} wireframe transparent opacity={0.22} />
      </mesh>

      <mesh ref={ref}>
        <octahedronGeometry args={[1.4, 0]} />
        <meshPhysicalMaterial
          color={p.primary}
          metalness={0.95}
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.08}
          emissive={p.primaryDark}
          emissiveIntensity={0.65}
        />
      </mesh>
    </group>
  )
}

function Ring({
  radius,
  tube,
  tilt,
  speed,
  color,
  opacity = 0.6,
}: {
  radius: number
  tube: number
  tilt: [number, number, number]
  speed: number
  color: string
  opacity?: number
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.z = state.clock.elapsedTime * speed
  })

  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, tube, 16, 128]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  )
}

/** Tilts the whole rig a few degrees toward the pointer. */
function ParallaxRig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const { viewport } = useThree()

  useFrame((state) => {
    if (!group.current) return
    const targetX = (state.pointer.x * viewport.width) / 60
    const targetY = (state.pointer.y * viewport.height) / 60
    group.current.rotation.y += (targetX - group.current.rotation.y) * 0.04
    group.current.rotation.x += (-targetY - group.current.rotation.x) * 0.04
  })

  return <group ref={group}>{children}</group>
}

export function HeroMark({ className }: { className?: string }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]

  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[3, 3, 3]} intensity={110} color={p.tintLight} />
        <pointLight position={[-3, -2, 2]} intensity={70} color={p.secondary} />
        <pointLight position={[0, -3, 4]} intensity={45} color={p.secondaryDark} />
        <ParallaxRig>
          <Core p={p} />
          <Ring radius={2.0} tube={0.012} tilt={[Math.PI / 2.4, 0, 0]} speed={0.16} color={p.primary} />
          <Ring radius={2.35} tube={0.008} tilt={[Math.PI / 1.8, 0.4, 0]} speed={-0.12} color={p.secondary} />
          <Ring radius={2.7} tube={0.01} tilt={[Math.PI / 2.9, -0.5, 0.3]} speed={0.09} color={p.secondaryDark} opacity={0.45} />
          <Ring radius={3.05} tube={0.006} tilt={[Math.PI / 2.1, 0.9, -0.4]} speed={-0.07} color={p.tintLighter} opacity={0.35} />
          <Sparkles count={60} scale={4.6} size={3.5} speed={0.35} color={p.tintLight} />
        </ParallaxRig>
      </Canvas>
    </div>
  )
}
