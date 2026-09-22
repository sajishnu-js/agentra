import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from its previous value to `target` over `durationMs`.
 * Used on the Home page's stat tiles, where a real number changing (a new
 * request came in, a filter switched agents) benefits from a visible count
 * rather than an instant, easy-to-miss digit swap — motion that carries
 * information, not decoration for its own sake.
 *
 * Skips the animation on the very first render (nothing to animate from)
 * and respects `prefers-reduced-motion` by jumping straight to the target.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target)
  const previous = useRef(target)
  const hasMounted = useRef(false)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!hasMounted.current || reduceMotion) {
      hasMounted.current = true
      previous.current = target
      setValue(target)
      return
    }

    const from = previous.current
    const delta = target - from
    if (delta === 0) return

    let frame: number
    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1)
      // Ease-out cubic — fast start, settles gently rather than ticking
      // linearly to a jarring stop.
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(from + delta * eased))
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        previous.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return value
}
