import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default:
          'btn-glossy bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.3),0_4px_14px_-4px_var(--brand-glow)] hover:brightness-110 active:brightness-95',
        glass:
          'glass text-foreground transition-colors hover:bg-glass-hover hover:border-brand/40 hover:text-foreground',
        outline:
          'btn-glossy border border-input bg-transparent text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[background-color,border-color,box-shadow] hover:bg-accent hover:border-ring/40 hover:text-accent-foreground hover:shadow-[0_2px_10px_-4px_var(--brand-glow)]',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:brightness-110',
        link: 'text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-8 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
