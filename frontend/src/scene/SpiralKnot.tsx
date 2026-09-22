import { useRef } from 'react'

import { THREE, useFrame, type Pointer } from './cinematic'

/**
 * THE SPIRAL — the landing page's hero subject.
 *
 * A torus knot: one strand winding twice around one axis and three times
 * around another, so it reads as a continuous coiling spiral with no start
 * or end. It turns on its own, leans toward the cursor, and spins up when
 * the CTA is hovered.
 */

/**
 * Shared handle for the hover-to-spin-faster interaction.
 *
 * A ref rather than React state on purpose: the CTA's hover changes ~60
 * times a second while the pointer crosses the edge, and routing that
 * through `setState` would re-render the whole hero on every one of them.
 * The frame loop reads the ref directly and nothing above it re-renders.
 */
export type SpinBoost = React.RefObject<{ target: number; value: number }>

export function useSpinBoost(): SpinBoost {
  return useRef({ target: 0, value: 0 })
}

export function SpiralKnot({
  pointer,
  boost,
  position = [0, 0, 0],
  scale = 1,
  tube = 0.34,
  /** Turns per second at rest. Slow on purpose: at ~0.16 the coil reads as
   *  busy, and the highlights sweeping across the metal never get a chance
   *  to settle. A full turn takes a little over thirteen seconds, which is
   *  what makes it feel like a machined object idling rather than an
   *  animation playing. */
  spin = 0.075,
  /** Multiplier applied at full hover. Higher than it was, so the CTA still
   *  produces an obvious change now that the resting speed is lower. */
  boostFactor = 4,
  lean = 0.32,
  children,
}: {
  pointer: Pointer
  boost?: SpinBoost
  position?: [number, number, number]
  scale?: number
  tube?: number
  spin?: number
  boostFactor?: number
  lean?: number
  children: React.ReactNode
}) {
  const knot = useRef<THREE.Mesh>(null)
  // Accumulated, not derived from elapsed time. Multiplying elapsed time by a
  // changing rate makes the angle jump backwards the instant the rate drops,
  // so the spiral would snap on mouse-out instead of easing down.
  const angle = useRef(0)

  useFrame((state, delta) => {
    const k = knot.current
    if (!k) return
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)

    if (boost) {
      const b = boost.current
      // Asymmetric easing: spins up briskly, coasts back down. A symmetric
      // ease makes the slow-down feel like the page is stalling.
      const rate = b.target > b.value ? 0.08 : 0.035
      b.value += (b.target - b.value) * rate
    }
    const factor = 1 + (boost ? boost.current.value : 0) * (boostFactor - 1)

    angle.current += dt * spin * Math.PI * 2 * factor
    k.rotation.y = angle.current
    k.rotation.z = Math.sin(t * 0.06) * 0.2
    k.rotation.x = -pointer.current.sy * lean + Math.sin(t * 0.1) * 0.09
  })

  return (
    <mesh ref={knot} position={position} scale={scale}>
      {/* 200 tubular segments: much lower and the strand visibly facets
          where it curves back on itself. */}
      <torusKnotGeometry args={[1, tube, 200, 36]} />
      {children}
    </mesh>
  )
}
