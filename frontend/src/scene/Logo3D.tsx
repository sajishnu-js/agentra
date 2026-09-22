import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'

function Mark({ color, emissive }: { color: string; emissive: string }) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = state.clock.elapsedTime * 0.6
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.3
  })

  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[1, 0]} />
      {/* `color`/`emissive` are plain string props — react-three-fiber calls
          .set() on the material's THREE.Color when they change, so switching
          accent re-tints this in place with no remount. */}
      <meshStandardMaterial
        color={color}
        metalness={0.85}
        roughness={0.15}
        emissive={emissive}
        emissiveIntensity={0.35}
      />
    </mesh>
  )
}

/** The sidebar's identity mark — a real, always-rotating 3D object, not an icon. */
export function Logo3D({ className }: { className?: string }) {
  const { accent } = useTheme()
  const p = scenePalettes[accent]

  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }} gl={{ alpha: true }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[2, 2, 2]} intensity={30} color={p.primary} />
        <pointLight position={[-2, -1, 1]} intensity={15} color={p.secondary} />
        <Mark color={p.primary} emissive={p.primaryDark} />
      </Canvas>
    </div>
  )
}
