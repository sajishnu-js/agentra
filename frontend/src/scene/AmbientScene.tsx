import { Float, MeshDistortMaterial } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * The app's signature backdrop: a handful of soft, floating glass-like forms
 * drifting behind every screen, replacing the old flat CSS gradient. One
 * Canvas, mounted once in AppShell, `position: fixed` and `pointer-events:
 * none` so it never competes with the actual UI for clicks — it's ambience,
 * not a widget.
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
    <Float speed={speed * 1.4} rotationIntensity={0.4} floatIntensity={1.2}>
      <mesh ref={ref} position={position} scale={scale}>
        <icosahedronGeometry args={[1, 4]} />
        <MeshDistortMaterial
          color={color}
          distort={0.35}
          speed={1.4}
          roughness={0.3}
          metalness={0.3}
          emissive={color}
          emissiveIntensity={0.3}
          transparent
          opacity={0.32}
        />
      </mesh>
    </Float>
  )
}

/** Drifts the whole rig a few degrees toward the pointer — depth, not a toy. */
function ParallaxRig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const { viewport } = useThree()

  useFrame((state) => {
    if (!group.current) return
    const targetX = (state.pointer.x * viewport.width) / 40
    const targetY = (state.pointer.y * viewport.height) / 40
    group.current.rotation.y += (targetX - group.current.rotation.y) * 0.02
    group.current.rotation.x += (-targetY - group.current.rotation.x) * 0.02
  })

  return <group ref={group}>{children}</group>
}

export function AmbientScene() {
  const { accent } = useTheme()
  const p = scenePalettes[accent]

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[-2]"
      // The mesh silhouettes are crisp by nature; a heavy blur on the whole
      // canvas is what turns them into soft, atmospheric glow rather than
      // flat coloured circles — cheaper than a real bloom post-process pass
      // and just as effective for something this far in the background.
      style={{ contain: 'strict', filter: 'blur(70px)' }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 9], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={40} color={p.primary} />
        <pointLight position={[-6, -3, 2]} intensity={28} color={p.secondary} />
        <ParallaxRig>
          <Blob position={[-4.6, 2.2, -6]} scale={1.9} color={p.primaryDark} speed={0.35} />
          <Blob position={[5, -1.8, -7]} scale={2.4} color={p.secondary} speed={0.28} />
          <Blob position={[1, 3.4, -8]} scale={1.4} color={p.tertiary} speed={0.42} />
          <Blob position={[-2.6, -3.2, -6.5]} scale={1.6} color={p.quaternary} speed={0.3} />
        </ParallaxRig>
      </Canvas>
    </div>
  )
}
