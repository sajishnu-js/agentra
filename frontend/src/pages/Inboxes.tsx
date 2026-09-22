import { Camera, Check, Copy, Loader2, Mail, MessageCircle, Plus, RefreshCw, Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { AgentPicker } from '@/components/AgentPicker'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { InboxStatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi } from '@/hooks/useApi'
import { useTilt } from '@/hooks/useTilt'
import { api, ApiError } from '@/lib/api'
import { channelLabel, relativeTime } from '@/lib/format'
import type { Channel, Inbox, IntegrationStatus } from '@/lib/types'

/** Telegram is long-polled (see app/telegram_bot.py) — it has no inbound
 * webhook at all, so there is nothing to show for it here. */
const WEBHOOK_PATH: Partial<Record<Channel, string>> = {
  whatsapp: '/webhooks/whatsapp',
  instagram: '/webhooks/instagram',
  email: '/webhooks/email',
}

function WebhookUrlRow({ channel }: { channel: Channel }) {
  const path = WEBHOOK_PATH[channel]
  const { data: integrations } = useApi<IntegrationStatus>('/settings/integrations')
  const [copied, setCopied] = useState(false)

  if (!path) {
    return (
      <p className="text-[11px] text-foreground-subtle">
        Uses long polling — no webhook to register.
      </p>
    )
  }

  const url = integrations?.public_base_url ? `${integrations.public_base_url}${path}` : path

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied by the browser — the URL is still
      // selectable text, so there is nothing more useful to do here.
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-foreground-subtle">Webhook URL</span>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 truncate rounded-md bg-black/20 px-2 py-1 text-[11px]">{url}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          title="Copy webhook URL"
          aria-label="Copy webhook URL"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      {!integrations?.public_base_url ? (
        <span className="text-[10px] text-warning">
          Set PUBLIC_BASE_URL in backend/.env for the real, callable address.
        </span>
      ) : null}
    </div>
  )
}

const channelIcon: Record<Channel, typeof Send> = {
  telegram: Send,
  whatsapp: MessageCircle,
  instagram: Camera,
  email: Mail,
}

const CHANNELS: Channel[] = ['whatsapp', 'telegram', 'instagram', 'email']

function InboxCard({ inbox, onUpdated }: { inbox: Inbox; onUpdated: () => void }) {
  const Icon = channelIcon[inbox.channel]
  const isPending = inbox.status === 'pending'
  const tilt = useTilt<HTMLDivElement>(8)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const { user } = useAuth()
  // /settings/integrations is staff-only (see settings/router.py's
  // require_staff) — an agent-role viewer of this page gets the rest of the
  // card with none of the webhook plumbing rather than a 403 in the console.
  const isStaff = user?.role === 'super_admin' || user?.role === 'admin'

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      await api.post(`/inboxes/${inbox.id}/sync`, {})
      onUpdated()
    } catch (caught) {
      setSyncError(caught instanceof ApiError ? caught.message : 'Could not connect')
      onUpdated() // status flips to disconnected server-side even on failure
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d flex-row flex-wrap items-center gap-4 p-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
        <Icon className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{inbox.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {channelLabel(inbox.channel)}
          {inbox.account_identifier ? ` · ${inbox.account_identifier}` : ''}
        </p>
        {syncError ? (
          <p className="mt-1 max-w-md text-xs text-destructive" role="alert">
            {syncError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-1">
        <InboxStatusPill status={inbox.status} />
        <span className="text-[11px] text-foreground-subtle">
          {inbox.last_synced_at
            ? `synced ${relativeTime(inbox.last_synced_at)} ago`
            : 'never synced'}
        </span>
      </div>

      <AgentPicker
        endpoint={`/inboxes/${inbox.id}`}
        field="default_agent_id"
        current={inbox.default_agent}
        onAssigned={onUpdated}
        noun="inbox"
      />

      <Button
        variant="glass"
        size="sm"
        disabled={syncing}
        onClick={handleSync}
        className="shrink-0"
      >
        {syncing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {isPending ? 'Connect' : 'Sync'}
      </Button>

      {isStaff ? (
        <div className="w-full border-t border-border pt-3">
          <WebhookUrlRow channel={inbox.channel} />
        </div>
      ) : null}
    </Card>
  )
}

/** Register a new channel connection — a name, which channel, and (once the
 * underlying account exists) its identifier. Created `pending`; Connect/Sync
 * on the resulting card is what actually verifies it (see InboxCard). */
function CreateInboxDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [accountIdentifier, setAccountIdentifier] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setChannel('whatsapp')
    setAccountIdentifier('')
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/inboxes', {
        name: name.trim(),
        channel,
        account_identifier: accountIdentifier.trim() || undefined,
      })
      onCreated()
      setOpen(false)
      reset()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this inbox')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className="cursor-pointer items-center gap-2 border-dashed p-8 text-center transition-colors hover:bg-glass-hover hover:border-brand/30"
      >
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Plus className="size-5" />
        </span>
        <p className="text-sm font-medium">Add a channel</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Connect WhatsApp, Telegram, Instagram or Email.
        </p>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a channel</DialogTitle>
            <DialogDescription>
              Name it and pick which channel it is. Once created, use Connect on the card to
              verify the credentials configured for it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inbox-name">Name</Label>
              <Input
                id="inbox-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Customer Support — WhatsApp"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(value) => setChannel(value as Channel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {channelLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inbox-identifier">Account identifier (optional)</Label>
              <Input
                id="inbox-identifier"
                value={accountIdentifier}
                onChange={(event) => setAccountIdentifier(event.target.value)}
                placeholder="Phone number, @handle or address"
              />
            </div>

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="glass" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !name.trim()}>
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Inboxes() {
  const { data, error, loading, reload } = useApi<Inbox[]>('/inboxes')

  // Guarded on `!data`, not bare `loading`/`error`: InboxCard's own sync
  // action calls onUpdated() (this reload) right after setting its local
  // syncError — an unguarded early return here would unmount every card,
  // including the one whose error message is about to render, on every
  // single sync attempt. See the identical fix in KnowledgeBase.tsx.
  if (loading && !data) return <LoadingState label="Loading inboxes…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data?.length) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <EmptyState
            title="No channels connected"
            description="Connect WhatsApp, Telegram, Instagram or Email to start receiving conversations."
          />
        </Card>
        <CreateInboxDialog onCreated={reload} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {data.map((inbox) => (
          <li key={inbox.id}>
            <InboxCard inbox={inbox} onUpdated={reload} />
          </li>
        ))}
      </ul>

      <CreateInboxDialog onCreated={reload} />
    </div>
  )
}
