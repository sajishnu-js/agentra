import { lazy, Suspense } from 'react'

import { cn } from '@/lib/utils'

const Logo3D = lazy(() => import('@/scene/Logo3D').then((m) => ({ default: m.Logo3D })))

/**
 * The Agentra lockup: the 3D mark inside a lit ring, with the wordmark
 * beside it.
 *
 * Shared rather than duplicated. The opening page and the sidebar carried
 * two byte-identical copies of this markup, which is how the wordmark's
 * clipped descender ended up needing fixing in two places at once.
 *
 * `size` exists because the two callers want slightly different weights of
 * the same thing, not different designs.
 */
export function BrandMark({
  className,
  style,
  size = 'md',
}: {
  className?: string
  style?: React.CSSProperties
  size?: 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'size-11' : 'size-10'
  const text = size === 'lg' ? 'text-[1.3rem]' : 'text-[1.15rem]'

  return (
    <span className={cn('flex items-center gap-3', className)} style={style}>
      <span className={cn('relative shrink-0', box)}>
        {/* The ring, and a dot tracking it clockwise with a short comet trail
            fading out behind. The circle was previously inert decoration. */}
        <span className="brand-ring" aria-hidden />
        <span className="brand-ring-trail" aria-hidden />
        <span className="brand-ring-dot" aria-hidden />

        {/* Inset so the mark sits *inside* the ring rather than touching it. */}
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-brand/20 to-primary/20 shadow-glow">
          <Suspense fallback={null}>
            <Logo3D className="size-full" />
          </Suspense>
        </span>
      </span>

      {/* No `leading-none` and no `truncate` here. Orbitron has a deep
          descender, and a line box of exactly 1em combined with truncate's
          overflow:hidden sheared the bottom off the "g". The wordmark's own
          line-height now leaves room for it, and `whitespace-nowrap` keeps
          the single word intact without clipping anything. */}
      <span className={cn('wordmark min-w-0 whitespace-nowrap font-semibold', text)}>
        Agentra
      </span>
    </span>
  )
}
