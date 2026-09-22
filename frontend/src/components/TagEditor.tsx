import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'

/**
 * Add and remove conversation tags.
 *
 * Tags are normalised server-side (lowercased, trimmed, deduplicated), so this
 * can stay a plain text box without the filter list filling up with "Billing",
 * "billing " and "BILLING".
 */
export function TagEditor({
  conversationId,
  tags,
  onChanged,
}: {
  conversationId: string
  tags: string[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(next: string[]) {
    setError(null)
    try {
      await api.patch(`/conversations/${conversationId}`, { tags: next })
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save tags')
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const tag = value.trim().toLowerCase()
    setValue('')
    setAdding(false)
    if (!tag || tags.includes(tag)) return
    await save([...tags, tag])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              onClick={() => save(tags.filter((entry) => entry !== tag))}
              className="rounded-full p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
              aria-label={`Remove tag ${tag}`}
            >
              <X className="size-2.5" />
            </button>
          </Badge>
        ))}

        {adding ? (
          <form onSubmit={add}>
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={add}
              placeholder="tag name"
              maxLength={40}
              className="h-6 w-28 px-2 text-xs"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="pill pill-muted transition-colors hover:text-foreground"
          >
            <Plus className="size-2.5" />
            Tag
          </button>
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
