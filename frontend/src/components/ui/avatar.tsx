import * as AvatarPrimitive from '@radix-ui/react-avatar'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        // A bare flat circle read as a cutout rather than an object sitting
        // on the panel — the ring + shadow give it an edge, and callers that
        // need a stronger ring (e.g. the selected thread in Conversations)
        // still win via twMerge since their className is applied last.
        'relative flex size-9 shrink-0 overflow-hidden rounded-full border border-glass-border ring-1 ring-border/50 shadow-[0_1px_4px_-1px_rgb(0_0_0/0.25)]',
        className,
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        // Inset highlight/shade pair, same technique as AccentOrb's glossy
        // sphere — reads as a lit marble instead of a flat tinted disc.
        'flex size-full items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text shadow-[inset_0_1px_1px_rgb(255_255_255/0.3),inset_0_-5px_8px_-5px_rgb(0_0_0/0.3)]',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
