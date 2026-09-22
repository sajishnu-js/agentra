import { Code2, Info, X } from 'lucide-react'
import { useState } from 'react'

import { DEMO_MODE } from '@/demo/mode'

/** Where "view the source" points. Overridable at build time so a fork does
 * not advertise someone else's repository. */
const REPO_URL = import.meta.env.VITE_REPO_URL ?? 'https://github.com/sajishnu-js/agentra'

/**
 * Tells the visitor that this deployment has no backend behind it.
 *
 * Worth being explicit about rather than quietly serving canned data: a
 * recruiter clicking through should be able to tell which parts are real
 * engineering and which are a snapshot, and "the AI replies are canned here"
 * is a better impression than leaving them to wonder whether the model is
 * simply bad.
 *
 * Dismissible, because it sits over a UI that is the actual thing being
 * shown off and should not be permanently obscured.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (!DEMO_MODE || dismissed) return null

  return (
    <div className="relative z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-brand/20 bg-brand/10 px-4 py-2 text-center text-xs text-foreground backdrop-blur">
      <span className="flex items-center gap-1.5 font-medium">
        <Info className="size-3.5 shrink-0" />
        Demo mode
      </span>
      <span className="text-muted-foreground">
        Live UI with a snapshot of seeded data — the FastAPI backend, Postgres
        and the AI pipeline run locally, not here. Edits persist until you
        reload.
      </span>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 font-medium text-brand-text underline underline-offset-2 hover:opacity-80"
      >
        <Code2 className="size-3.5" />
        Source
      </a>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss demo notice"
        className="absolute right-2 top-1.5 rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
