import { Sparkles } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * The landing page's backdrop. AmbientScene (used on every dashboard screen)
 * stays deliberately calm — it sits behind dense data. This page only has
 * to carry one screenful of marketing content, so it can afford to be
 * busier: more floating forms spread into the corners that AmbientScene
 * leaves empty, plus a drifting star field and two large, slow "aura" rings
 * out at the flanks. Everything is still heavily blurred (see the wrapper
 * div below), which is what keeps a much busier scene from reading as
 * cluttered — it stays atmosphere, not shapes competing with the headline.
 */

function Blob({
  position,
  scale,
  color,
  speed,
}: {
  position: [number, number, number]
  scale: number
  color: string
  speed: number
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime * speed
    ref.current.rotation.x = t * 0.3
    ref.current.rotation.y = t * 0.22
  })

  return (
    <mesh ref={ref} position={position} scale={scale}>
      <icosahedronGeometry args={[1, 3]} />
      <meshStandardMaterial
        color={color}
        roughness={0.3}
        metalness={0.3}
        emissive={color}
        emissiveIntensity={0.3}
        transparent
        opacity={0.34}
      />
    </mesh>
  )
}

/** A big, thick, faint torus out at the edge — reads as a slow orbital arc
 *  once blurred, filling the flanks either side of the centered content. */
function AuraRing({
  position,
  radius,
  tilt,
  speed,
  color,
}: {
  position: [number, number, number]
  radius: number
  tilt: [number, number, number]
  speed: number
  color: string
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.z = state.clock.elapsedTime * speed
  })

  return (
    <mesh ref={ref} position={position} rotation={tilt}>
      <torusGeometry args={[radius, radius * 0.05, 16, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.16} />
    </mesh>
  )
}

function ParallaxRig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const { viewport } = useThree()

  useFrame((state) => {
    if (!group.current) return
    const targetX = (state.pointer.x * viewport.width) / 50
    const targetY = (state.pointer.y * viewport.height) / 50
    group.current.rotation.y += (targetX - group.current.rotation.y) * 0.015
    group.current.rotation.x += (-targetY - group.current.rotation.x) * 0.015
  })

  return <group ref={group}>{children}</group>
}

export function LandingScene() {
  const { accent } = useTheme()
  const p = scenePalettes[accent]

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[-2]"
      style={{ contain: 'strict', filter: 'blur(64px)' }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 9], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={40} color={p.primary} />
        <pointLight position={[-6, -3, 2]} intensity={28} color={p.secondary} />
        <pointLight position={[0, 4, -4]} intensity={20} color={p.secondaryDark} />
        <ParallaxRig>
          {/* Corners and flanks — AmbientScene's positions plus more,
              spread wider so the empty thirds of the viewport get motion. */}
          <Blob position={[-6.4, 2.6, -6]} scale={1.9} color={p.primaryDark} speed={0.32} />
          <Blob position={[6.6, -2.2, -7]} scale={2.3} color={p.secondary} speed={0.26} />
          <Blob position={[1.2, 4.2, -8]} scale={1.4} color={p.tertiary} speed={0.4} />
          <Blob position={[-3.4, -3.8, -6.5]} scale={1.6} color={p.quaternary} speed={0.3} />
          <Blob position={[7.2, 3.4, -9]} scale={1.7} color={p.quinary} speed={0.22} />
          <Blob position={[-7.6, -1.6, -8]} scale={1.5} color={p.secondary} speed={0.35} />
          <Blob position={[0, -5.2, -9]} scale={1.3} color={p.primaryDark} speed={0.28} />

          <AuraRing
            position={[-8, 0.4, -10]}
            radius={4.2}
            tilt={[Math.PI / 2.3, 0.3, 0]}
            speed={0.05}
            color={p.primaryDark}
          />
          <AuraRing
            position={[8.4, -0.6, -11]}
            radius={5}
            tilt={[Math.PI / 2.6, -0.4, 0.2]}
            speed={-0.04}
            color={p.secondary}
          />

          <Sparkles count={140} scale={[18, 11, 8]} size={7} speed={0.25} color={p.tintPale} />
        </ParallaxRig>
      </Canvas>
    </div>
  )
}
