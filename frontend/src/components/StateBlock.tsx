import { AlertCircle, Inbox, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Shared loading / error / empty states, so every screen fails the same way. */

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground',
        className,
      )}
      role="status"
    >
      <Loader2 className="size-4 animate-spin text-brand-text" />
      {label}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 p-10 text-center', className)}
      role="alert"
    >
      <span className="relative grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive shadow-[0_0_24px_-6px_var(--destructive)]">
        <AlertCircle className="size-5" />
      </span>
      <div>
        <p className="text-sm font-medium">Could not load this</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
      </div>
      {onRetry ? (
        <Button variant="glass" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 p-10 text-center', className)}>
      {/* A soft glow behind the icon rather than a flat muted circle — the
          same "lit from behind" cue the glass panels use, scaled down. */}
      <span className="relative grid size-12 place-items-center">
        <span
          aria-hidden
          className="ambient-glow absolute inset-0 bg-brand opacity-20"
        />
        <span className="relative grid size-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
          <Inbox className="size-5" />
        </span>
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
