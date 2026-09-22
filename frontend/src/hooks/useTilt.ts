import { useCallback, useRef } from 'react'

/**
 * Mouse-driven 3D tilt for a card, in plain CSS transforms — no WebGL context
 * per card, which would blow past the browser's concurrent-context limit the
 * moment a list of these renders. Reserve real WebGL (`scene/`) for the one
 * or two showcase elements; every other "3D" surface is perspective + a
 * rotateX/rotateY driven by pointer position, reset with a spring-ish ease
 * on leave.
 */
export function useTilt<T extends HTMLElement>(strength = 10) {
  const ref = useRef<T>(null)

  const onMouseMove = useCallback(
    (event: React.MouseEvent<T>) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width - 0.5
      const py = (event.clientY - rect.top) / rect.height - 0.5
      el.style.setProperty('--tilt-x', `${(-py * strength).toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${(px * strength).toFixed(2)}deg`)
      el.style.setProperty('--tilt-glow-x', `${(px * 0.5 + 0.5) * 100}%`)
      el.style.setProperty('--tilt-glow-y', `${(py * 0.5 + 0.5) * 100}%`)
    },
    [strength],
  )

  const onMouseLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tilt-x', '0deg')
    el.style.setProperty('--tilt-y', '0deg')
  }, [])

  return { ref, onMouseMove, onMouseLeave }
}
