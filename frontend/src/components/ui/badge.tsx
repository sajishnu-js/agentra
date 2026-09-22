import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap w-fit shrink-0',
  {
    variants: {
      // btn-glossy's top-highlight is a background-image layer, not a
      // shadow, so it can't bleed into a neighbouring cell the way an outer
      // glow did before (see .pill's own note on that) — safe even in a
      // dense table. Left off `outline`, which is meant to render as a bare
      // bordered pill with no fill.
      variant: {
        default: 'btn-glossy border-transparent bg-primary text-primary-foreground',
        secondary: 'btn-glossy border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        brand: 'btn-glossy border-brand/30 bg-brand-soft text-brand-text',
        success: 'btn-glossy border-transparent bg-success/15 text-success',
        warning: 'btn-glossy border-transparent bg-warning/15 text-warning',
        destructive: 'btn-glossy border-transparent bg-destructive/15 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
