import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/** Identical header shape across every Settings section — icon chip, title,
 * one-line description — factored out once it repeated a dozen times. */
export function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border p-5 pb-4">
      <span className="glass grid size-9 shrink-0 place-items-center rounded-xl text-brand-text">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-foreground-subtle">{hint}</p> : null}
    </div>
  )
}

/** The save/reset row at the bottom of every editable section. `dirty` gates
 * both buttons — there is nothing to save or discard otherwise. */
export function SaveBar({
  dirty,
  saving,
  error,
  saved,
  onSave,
  onReset,
}: {
  dirty: boolean
  saving: boolean
  error: string | null
  saved: boolean
  onSave: () => void
  onReset?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border p-5">
      <div className="text-xs">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : saved ? (
          <span className="text-success">Saved</span>
        ) : dirty ? (
          <span className="text-foreground-subtle">Unsaved changes</span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {onReset ? (
          <Button type="button" variant="glass" size="sm" disabled={!dirty || saving} onClick={onReset}>
            Reset
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
