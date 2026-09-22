import {
  Bot,
  Check,
  CheckSquare,
  Download,
  FileText,
  Languages,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Square,
  StickyNote,
  Tags,
  Ticket,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { type ChangeEvent, type FormEvent, type MouseEvent, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { AgentPicker } from '@/components/AgentPicker'
import { AssignmentPicker } from '@/components/AssignmentPicker'
import { HandoverBadge, HandoverNotice } from '@/components/HandoverNotice'
import { TagEditor } from '@/components/TagEditor'
import { ReplyWindowBanner } from '@/components/ReplyWindowBanner'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { api, ApiError } from '@/lib/api'
import {
  ConversationStatusPill,
  PriorityPill,
  RequestStatusPill,
} from '@/components/StatusPill'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/useApi'
import { useRequireDeleteConfirmation } from '@/hooks/useRequireDeleteConfirmation'
import {
  channelLabel,
  clockTime,
  initials,
  isOutsideReplyWindow,
  isRtl,
  languageLabel,
  longDateTime,
  maskPhoneNumber,
  relativeAge,
  relativeTime,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  Channel,
  Contact,
  ContactNote,
  ConversationDetail,
  ConversationListItem,
  Message,
} from '@/lib/types'

const ACCEPTED_ATTACHMENT_TYPES = 'image/*,.pdf,.doc,.docx,.txt'
const CHANNELS: Channel[] = ['whatsapp', 'telegram', 'instagram', 'email']

/** One thread's quick actions — pin/unpin and mark read/unread. Each is a
 * small, self-contained PATCH; `onChanged` is Conversations' own `reload`,
 * the same convention every other mutator in this file already follows. */
function ThreadQuickActions({
  conversation,
  onChanged,
}: {
  conversation: ConversationListItem
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<'pin' | 'unread' | null>(null)

  async function patch(event: MouseEvent, field: 'is_pinned' | 'is_unread', value: boolean) {
    event.stopPropagation()
    setBusy(field === 'is_pinned' ? 'pin' : 'unread')
    try {
      await api.patch(`/conversations/${conversation.id}`, { [field]: value })
      onChanged()
    } catch {
      // Best-effort quick actions — a failed toggle just leaves the row as
      // it was, with nothing destructive to roll back.
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        title={conversation.is_pinned ? 'Unpin' : 'Pin'}
        aria-label={conversation.is_pinned ? 'Unpin conversation' : 'Pin conversation'}
        disabled={busy !== null}
        onClick={(event) => patch(event, 'is_pinned', !conversation.is_pinned)}
        className="rounded p-1 hover:bg-accent hover:text-foreground"
      >
        {busy === 'pin' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : conversation.is_pinned ? (
          <PinOff className="size-3" />
        ) : (
          <Pin className="size-3" />
        )}
      </button>
      <button
        type="button"
        title={conversation.is_unread ? 'Mark as read' : 'Mark as unread'}
        aria-label={conversation.is_unread ? 'Mark as read' : 'Mark as unread'}
        disabled={busy !== null}
        onClick={(event) => patch(event, 'is_unread', !conversation.is_unread)}
        className="rounded p-1 hover:bg-accent hover:text-foreground"
      >
        {busy === 'unread' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : conversation.is_unread ? (
          <MailOpen className="size-3" />
        ) : (
          <Mail className="size-3" />
        )}
      </button>
    </div>
  )
}

/** Left pane: every thread, newest inbound first (pinned ones first among
 * those — see the ordering in GET /conversations). */
function ThreadList({
  conversations,
  selectedId,
  onSelect,
  onChanged,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  conversations: ConversationListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChanged: () => void
  selectionMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}) {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      {conversations.map((conversation) => {
        const isSelected = conversation.id === selectedId
        const stale = isOutsideReplyWindow(
          conversation.contact.channel,
          conversation.last_incoming_at,
        )
        const needsHuman = conversation.status === 'pending'
        const checked = selectedIds.has(conversation.id)
        return (
          <li key={conversation.id}>
            <div
              className={cn(
                'group relative flex items-start gap-1 overflow-hidden rounded-xl p-3 transition-all duration-150',
                isSelected
                  ? 'bg-gradient-to-r from-brand-soft to-brand-soft/40 shadow-[inset_0_1px_0_0_var(--glass-highlight)]'
                  : needsHuman
                    ? 'bg-warning/8 hover:bg-warning/14'
                    : 'hover:bg-accent/60',
              )}
            >
              {/* The selected indicator wins the slot; an unselected thread
                  that needs a human gets an amber one instead. Only the
                  selected bar breathes (glow-pulse) — there is always
                  exactly one, unlike "needs human" which can be several
                  rows at once and would turn into a distracting light show. */}
              {isSelected || needsHuman ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 left-0 h-8 w-[3px] -translate-y-1/2 rounded-r-full',
                    isSelected ? 'bg-brand glow-pulse' : 'bg-warning',
                  )}
                />
              ) : null}

              {selectionMode ? (
                <button
                  type="button"
                  onClick={() => onToggleSelect(conversation.id)}
                  aria-label={checked ? 'Deselect conversation' : 'Select conversation'}
                  className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {checked ? (
                    <CheckSquare className="size-4 text-brand-text" />
                  ) : (
                    <Square className="size-4" />
                  )}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                aria-current={isSelected}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar
                    className={cn(
                      'size-8',
                      isSelected && 'ring-2 ring-brand/40 shadow-[0_2px_10px_-3px_var(--brand)]',
                    )}
                  >
                    <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      {conversation.is_unread ? (
                        <span
                          aria-label="Unread"
                          className="size-1.5 shrink-0 rounded-full bg-brand"
                        />
                      ) : null}
                      {conversation.is_pinned ? (
                        <Pin className="size-3 shrink-0 text-brand-text" aria-label="Pinned" />
                      ) : null}
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm',
                          conversation.is_unread ? 'font-semibold' : 'font-medium',
                        )}
                      >
                        {conversation.contact.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-foreground-subtle">
                        {relativeTime(conversation.last_incoming_at)}
                      </span>
                    </div>
                    <span
                      className="block truncate text-xs text-muted-foreground"
                      dir={isRtl(conversation.last_message?.text ?? null) ? 'rtl' : 'ltr'}
                    >
                      {conversation.last_message?.text ?? 'No messages yet'}
                    </span>
                  </div>
                </div>
                {/* min-w-0 + overflow-hidden on the row, and a shrinking
                    inner group: a thread with a handover badge and two long
                    tags used to push the message count past the card's edge
                    at every viewport width. */}
                <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden pl-10.5">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                    {conversation.handover_reason ? (
                      <HandoverBadge reason={conversation.handover_reason} />
                    ) : (
                      <span className="shrink-0 text-[11px] text-foreground-subtle">
                        {channelLabel(conversation.contact.channel)}
                      </span>
                    )}
                    {stale ? (
                      <span
                        aria-label="Outside the 24-hour reply window"
                        className="size-1.5 shrink-0 rounded-full bg-warning"
                      />
                    ) : null}
                    {/* shrink-0: without it flex compresses a short tag like
                        "deposit" down to a single truncated letter. The tag
                        keeps its natural width, max-w only catches a genuinely
                        long one, and the row's overflow-hidden handles the
                        rest. */}
                    {conversation.tags.slice(0, 2).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="h-4.5 max-w-28 shrink-0 truncate px-1.5 text-[10px]"
                        title={tag}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <Badge variant="secondary" className="h-4.5 shrink-0 px-1.5 text-[10px]">
                    {conversation.message_count}
                  </Badge>
                </div>
              </button>

              {!selectionMode ? (
                <ThreadQuickActions conversation={conversation} onChanged={onChanged} />
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** One attachment, inline in a bubble — an image renders directly, anything
 * else is a small file chip. Either way it is a real link to the stored
 * file (served by the backend's /uploads mount), not a decorative icon. */
function AttachmentPreview({ message }: { message: Message }) {
  if (!message.attachment_url) return null
  const isImage = message.attachment_content_type?.startsWith('image/') ?? false

  if (isImage) {
    return (
      <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-1 block">
        <img
          src={message.attachment_url}
          alt={message.attachment_filename ?? 'Attachment'}
          className="max-h-56 max-w-full rounded-lg object-contain"
        />
      </a>
    )
  }

  return (
    <a
      href={message.attachment_url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 flex items-center gap-2 rounded-lg border border-current/15 bg-black/10 p-2 text-xs no-underline transition-colors hover:bg-black/20"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-black/10">
        <FileText className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{message.attachment_filename ?? 'Attachment'}</span>
      <Download className="size-3.5 shrink-0 opacity-70" />
    </a>
  )
}

/** One message bubble. Owns its own edit-in-place state, so editing one
 * message never disturbs any other — and, since that state lives inside
 * whatever Thread's own reload() re-renders, Thread's loading guard has to
 * be `loading && !data` (see below) or a save/delete would blow it away
 * mid-edit. */
function MessageBubble({
  message,
  conversationId,
  requireConfirmation,
  onChanged,
}: {
  message: Message
  conversationId: string
  requireConfirmation: boolean
  onChanged: () => void
}) {
  const outgoing = message.direction === 'outgoing'
  const rtl = isRtl(message.text)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canModify = message.is_staff_reply

  async function handleSaveEdit() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/conversations/${conversationId}/messages/${message.id}`, { text })
      setEditing(false)
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this edit')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy) return
    if (requireConfirmation && !window.confirm('Delete this message? This cannot be undone.'))
      return
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/conversations/${conversationId}/messages/${message.id}`)
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this message')
      setBusy(false)
    }
  }

  return (
    <div className={cn('group flex flex-col gap-1', outgoing ? 'items-end' : 'items-start')}>
      <div
        dir={rtl ? 'rtl' : 'ltr'}
        className={cn(
          'flex max-w-[80%] flex-col gap-1 px-3.5 py-2.5 text-sm',
          outgoing
            ? 'btn-glossy rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_var(--brand-glow)]'
            : 'rounded-2xl rounded-bl-md glass-inset text-foreground',
        )}
      >
        {outgoing ? (
          <span className="flex items-center gap-1.5 text-[11px] opacity-80">
            {message.is_staff_reply ? (
              <>
                <UserRound className="size-3" />
                You
              </>
            ) : (
              <>
                <Bot className="size-3" />
                Support Agent
              </>
            )}
          </span>
        ) : null}

        {editing ? (
          <div className="flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              autoFocus
              className="min-w-56 border-white/20 bg-white/10 text-inherit placeholder:text-inherit/60"
            />
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setDraft(message.text ?? '')
                  setError(null)
                }}
              >
                <X className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={busy || !draft.trim()}
                onClick={handleSaveEdit}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <span>
              {message.text ?? (!message.attachment_url ? <em className="opacity-70">Attachment</em> : null)}
            </span>
            <AttachmentPreview message={message} />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        {clockTime(message.created_at)}
        {outgoing ? <span className="capitalize">· {message.status}</span> : null}
        {message.edited_at ? <span>· edited</span> : null}
        {message.kb_chunks_used?.length ? (
          <span
            title={`Answered using ${message.kb_chunks_used.length} knowledge base chunk(s)`}
            className="text-brand-text"
          >
            · {message.kb_chunks_used.length} source
            {message.kb_chunks_used.length === 1 ? '' : 's'}
          </span>
        ) : null}
        {canModify && !editing ? (
          <span className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="Edit"
              onClick={() => setEditing(true)}
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              title="Delete"
              disabled={busy}
              onClick={handleDelete}
              className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            </button>
          </span>
        ) : null}
      </div>
      {error ? <p className="max-w-[80%] text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}

/** Centre pane: the message thread, plus the composer that writes to it. */
function Thread({ conversationId, stale }: { conversationId: string; stale: boolean }) {
  const { data, error, loading, reload } = useApi<Message[]>(
    `/conversations/${conversationId}/messages`,
    // A reply is written by the worker seconds after the customer's message
    // lands, so the open thread is the one place that has to feel live.
    { pollMs: 4000 },
  )
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Fetched once here rather than per-bubble — a thread can hold many
  // messages, and each one's delete would otherwise redundantly re-fetch it.
  const requireConfirmation = useRequireDeleteConfirmation()

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setSendError(null)
    try {
      await api.post(`/conversations/${conversationId}/messages`, { text })
      setDraft('')
      await reload()
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Could not send that message.')
    } finally {
      setSending(false)
    }
  }

  async function handleAttach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setAttaching(true)
    setSendError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (draft.trim()) form.append('caption', draft.trim())
      await api.upload(`/conversations/${conversationId}/attachments`, form)
      setDraft('')
      await reload()
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Could not send that attachment.')
    } finally {
      setAttaching(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* Guarded on `!data`, not bare `loading`/`error`: editing or
            deleting a message below calls this same reload() (via
            MessageBubble's onChanged), which flips `loading` true for one
            tick. An unguarded branch here would unmount every bubble —
            including the one whose edit just succeeded — right as it
            resolves. */}
        {loading && !data ? (
          <LoadingState label="Loading messages…" />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.length ? (
          <EmptyState title="No messages yet" />
        ) : (
          // mt-auto pins a short thread to the bottom without breaking
          // scrolling once it is long enough to overflow.
          <div className="mt-auto flex flex-col gap-3">
            {data.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                conversationId={conversationId}
                requireConfirmation={requireConfirmation}
                onChanged={reload}
              />
            ))}
          </div>
        )}
      </div>

      <Separator />
      <form className="flex flex-col gap-1.5 p-3" onSubmit={handleSend}>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_ATTACHMENT_TYPES}
            className="hidden"
            onChange={handleAttach}
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Attach a file"
            disabled={stale || sending || attaching}
            onClick={() => fileInputRef.current?.click()}
          >
            {attaching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </Button>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={stale ? 'Template required to reply…' : 'Write a reply…'}
            className="flex-1"
            disabled={stale || sending || attaching}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send reply"
            disabled={stale || sending || attaching || !draft.trim()}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        {sendError ? <p className="px-1 text-xs text-destructive">{sendError}</p> : null}
      </form>
    </div>
  )
}

/** Internal staff notes on the contact — not visible to the customer, and
 * not tied to any one conversation (see backend ContactNote: keyed by
 * contact_id, not conversation_id), so a note written from one thread shows
 * up on every other thread with this same contact too. */
function ContactNotes({ contactId }: { contactId: string }) {
  const { user } = useAuth()
  const { data: notes, error, loading, reload } = useApi<ContactNote[]>(
    `/contacts/${contactId}/notes`,
  )
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error2, setError2] = useState<string | null>(null)
  const requireConfirmation = useRequireDeleteConfirmation()
  const isStaff = user?.role === 'super_admin' || user?.role === 'admin'

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setError2(null)
    try {
      await api.post(`/contacts/${contactId}/notes`, { text })
      setDraft('')
      await reload()
    } catch (caught) {
      setError2(caught instanceof ApiError ? caught.message : 'Could not save this note')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId: string) {
    if (requireConfirmation && !window.confirm('Delete this note? This cannot be undone.')) return
    try {
      await api.delete(`/contacts/${contactId}/notes/${noteId}`)
      await reload()
    } catch (caught) {
      setError2(caught instanceof ApiError ? caught.message : 'Could not delete this note')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <StickyNote className="size-3.5" />
        Internal notes
      </p>

      {loading && !notes ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : error && !notes ? (
        <p className="text-xs text-destructive">Could not load notes</p>
      ) : !notes?.length ? (
        <p className="text-xs text-muted-foreground">No notes on this contact yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => {
            const canDelete = isStaff || note.author?.id === user?.id
            return (
              <li key={note.id} className="glass-inset group rounded-md p-2.5">
                <p className="text-xs whitespace-pre-wrap">{note.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-foreground-subtle">
                    {note.author?.name ?? 'Former staff member'} · {relativeTime(note.created_at)}
                  </span>
                  {canDelete ? (
                    <button
                      type="button"
                      title="Delete note"
                      aria-label="Delete note"
                      onClick={() => handleDelete(note.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-1.5">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a note only staff can see…"
          rows={2}
          className="text-xs"
        />
        <div className="flex items-center justify-end gap-2">
          {error2 ? <p className="text-[11px] text-destructive">{error2}</p> : null}
          <Button type="submit" size="sm" variant="glass" disabled={saving || !draft.trim()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Right pane: who this is and what is outstanding. */
function DetailPanel({ conversationId }: { conversationId: string }) {
  const { data, error, loading, reload } = useApi<ConversationDetail>(
    `/conversations/${conversationId}`,
    { pollMs: 10000 },
  )

  // Guarded on `!data`: the AI-agent AgentPicker below calls this same
  // reload() on success, and its own Sheet has local open/saving state that
  // an unguarded remount would discard mid-interaction — same reasoning as
  // Thread above.
  if (loading && !data) return <LoadingState label="Loading details…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar className="size-14">
          <AvatarFallback className="text-base">
            {initials(data.contact.name)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-semibold">{data.contact.name}</p>
          <p className="text-xs text-muted-foreground">
            {channelLabel(data.contact.channel)}
          </p>
        </div>
        <ConversationStatusPill status={data.status} />
        {data.handover_reason ? (
          <HandoverBadge reason={data.handover_reason} />
        ) : null}
      </div>

      {data.handover_reason ? (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold">Why this needs a person</p>
            <p className="font-mono text-[11px] break-words text-muted-foreground">
              {data.handover_detail ?? 'No detail recorded.'}
            </p>
            {data.handover_at ? (
              <p className="text-[11px] text-foreground-subtle">
                Raised {relativeAge(data.handover_at)}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <Separator />

      <dl className="flex flex-col gap-3 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="size-3.5" />
            Phone
          </dt>
          <dd className="text-right font-medium">
            {maskPhoneNumber(data.contact.phone_number, data.contact.channel) ?? 'Not shared'}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Languages className="size-3.5" />
            Language
          </dt>
          <dd className="text-right font-medium">
            {languageLabel(data.contact.language)}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound className="size-3.5" />
            Assigned
          </dt>
          <dd className="text-right font-medium">
            {data.assigned_agent?.name ?? 'Unassigned'}
          </dd>
        </div>
        <div className="flex flex-col gap-1.5">
          <dd className="w-full">
            <AgentPicker
              endpoint={`/conversations/${data.id}`}
              field="agent_id"
              current={data.agent}
              onAssigned={reload}
              noun="conversation"
              className="w-full justify-start"
            />
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Last inbound</dt>
          <dd className="text-right font-medium">
            {data.last_incoming_at ? longDateTime(data.last_incoming_at) : '—'}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Messages</dt>
          <dd className="text-right font-medium tabular-nums">{data.message_count}</dd>
        </div>
      </dl>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Tags className="size-3.5" />
          Tags
        </p>
        <TagEditor conversationId={data.id} tags={data.tags} onChanged={reload} />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Ticket className="size-3.5" />
          Requests ({data.requests.length})
        </p>
        {data.requests.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing extracted from this thread.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.requests.map((request) => (
              <li key={request.id} className="glass-inset rounded-md p-2.5">
                <p className="text-xs font-medium">{request.title}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <RequestStatusPill status={request.status} />
                  <PriorityPill priority={request.priority} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      <ContactNotes contactId={data.contact.id} />
    </div>
  )
}

/** Start a conversation from the dashboard rather than an inbound message —
 * an existing contact, or a new one described inline. */
function NewConversationDialog({ onCreated }: { onCreated: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const { data: contacts } = useApi<Contact[]>(open && mode === 'existing' ? '/contacts' : null)
  const [contactId, setContactId] = useState('')
  const [contactName, setContactName] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [externalId, setExternalId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setMode('existing')
    setContactId('')
    setContactName('')
    setChannel('whatsapp')
    setExternalId('')
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const body =
        mode === 'existing'
          ? { contact_id: contactId }
          : {
              contact_name: contactName.trim(),
              channel,
              external_id: externalId.trim() || undefined,
            }
      const conversation = await api.post<ConversationDetail>('/conversations', body)
      onCreated(conversation.id)
      setOpen(false)
      reset()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start this conversation')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = mode === 'existing' ? contactId !== '' : contactName.trim() !== ''

  return (
    <>
      <Button
        size="sm"
        variant="glass"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Plus className="size-3.5" />
        New
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a conversation</DialogTitle>
            <DialogDescription>
              Pick someone who has already messaged in, or log a new contact.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'existing' ? 'default' : 'glass'}
                onClick={() => setMode('existing')}
              >
                Existing contact
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'new' ? 'default' : 'glass'}
                onClick={() => setMode('new')}
              >
                New contact
              </Button>
            </div>

            {mode === 'existing' ? (
              <div className="flex flex-col gap-1.5">
                <Label>Contact</Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contacts ?? []).map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name} · {channelLabel(contact.channel)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-contact-name">Name</Label>
                  <Input
                    id="new-contact-name"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    required
                    autoFocus
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
                  <Label htmlFor="new-contact-external-id">Channel identifier (optional)</Label>
                  <Input
                    id="new-contact-external-id"
                    value={externalId}
                    onChange={(event) => setExternalId(event.target.value)}
                    placeholder="Phone number, @handle or chat id"
                  />
                </div>
              </>
            )}

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="glass" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !canSubmit}>
                {saving ? 'Starting…' : 'Start'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Conversations() {
  const { conversationId: routeConversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const listPath = tagFilter
    ? `/conversations?tag=${encodeURIComponent(tagFilter)}`
    : '/conversations'
  const { data, error, loading, reload } = useApi<ConversationListItem[]>(listPath, {
    pollMs: 8000,
  })
  const { data: allTags } = useApi<string[]>('/conversations/tags')

  // The URL is the source of truth for which thread is open — a plain visit
  // to /app/conversations has no id and falls back to the newest thread
  // below, while /app/conversations/:id (a search result, a notification's
  // link) opens that specific one. `replace: true` on every select so
  // clicking around the inbox doesn't fill up browser history one entry per
  // thread.
  function handleSelect(id: string) {
    navigate(`/app/conversations/${id}`, { replace: true })
  }
  // Client-side, against the already-loaded list — filtering by name has no
  // server-side query param (unlike tag, which is a GIN-indexed array
  // containment check worth pushing down), and this app's conversation
  // counts don't come close to needing one.
  const [nameQuery, setNameQuery] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const requireConfirmation = useRequireDeleteConfirmation()

  function toggleSelectionMode() {
    setSelectionMode((current) => !current)
    setSelectedIds(new Set())
    setBulkError(null)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulk(action: 'read' | 'unread' | 'pin' | 'unpin' | 'delete') {
    if (bulkBusy || selectedIds.size === 0) return
    if (action === 'delete') {
      const prompt = `Delete ${selectedIds.size} conversation(s)? This cannot be undone.`
      if (requireConfirmation && !window.confirm(prompt)) return
    }
    setBulkBusy(true)
    setBulkError(null)
    try {
      const ids = Array.from(selectedIds)
      await Promise.all(
        ids.map((id) => {
          switch (action) {
            case 'delete':
              return api.delete(`/conversations/${id}`)
            case 'read':
              return api.patch(`/conversations/${id}`, { is_unread: false })
            case 'unread':
              return api.patch(`/conversations/${id}`, { is_unread: true })
            case 'pin':
              return api.patch(`/conversations/${id}`, { is_pinned: true })
            case 'unpin':
              return api.patch(`/conversations/${id}`, { is_pinned: false })
          }
        }),
      )
      setSelectedIds(new Set())
      await reload()
    } catch (caught) {
      setBulkError(
        caught instanceof ApiError ? caught.message : 'Some of those actions could not be completed',
      )
    } finally {
      setBulkBusy(false)
    }
  }

  /** A plain-text transcript, built from a fresh fetch rather than whatever
   * Thread happens to have loaded — this button lives in the header row
   * above Thread, not inside it, and re-fetching a handful of messages on
   * click is simpler and just as correct as lifting that state up. */
  async function handleExportTranscript(conversation: ConversationListItem) {
    if (exportingId) return
    setExportingId(conversation.id)
    try {
      const messages = await api.get<Message[]>(`/conversations/${conversation.id}/messages`)
      const header = [
        `Conversation with ${conversation.contact.name} (${channelLabel(conversation.contact.channel)})`,
        `Exported ${longDateTime(new Date().toISOString())}`,
        '',
      ]
      const body = messages.map((message) => {
        const speaker =
          message.direction === 'incoming'
            ? conversation.contact.name
            : message.is_staff_reply
              ? 'Staff'
              : 'Support Agent (AI)'
        const text =
          message.text ??
          (message.attachment_filename ? `[Attachment: ${message.attachment_filename}]` : '[Attachment]')
        return `[${longDateTime(message.created_at)}] ${speaker}: ${text}`
      })
      const blob = new Blob([[...header, ...body].join('\n')], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const slug = conversation.contact.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'contact'
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `transcript-${slug}-${conversation.id.slice(0, 8)}.txt`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      // Nothing persisted, nothing to roll back — a failed export just
      // leaves the button clickable again.
    } finally {
      setExportingId(null)
    }
  }

  // Guarded on `!data`: the human AssignmentPicker in the thread header below
  // calls this same reload() on success, and its own Sheet has local
  // open/saving state an unguarded remount would discard mid-interaction —
  // same reasoning as Thread/DetailPanel above.
  if (loading && !data) return <LoadingState label="Loading conversations…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data?.length) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <EmptyState
            title="No conversations yet"
            description="Once a channel is connected, threads will appear here."
          />
        </Card>
        <NewConversationDialog
          onCreated={(id) => {
            reload()
            handleSelect(id)
          }}
        />
      </div>
    )
  }

  const selected =
    data.find((conversation) => conversation.id === routeConversationId) ?? data[0]
  const stale = isOutsideReplyWindow(
    selected.contact.channel,
    selected.last_incoming_at,
  )

  const trimmedQuery = nameQuery.trim().toLowerCase()
  const visibleConversations = trimmedQuery
    ? data.filter((conversation) => conversation.contact.name.toLowerCase().includes(trimmedQuery))
    : data

  return (
    <div className="relative grid h-full min-h-0 gap-4 overflow-hidden lg:grid-cols-[19rem_1fr] xl:grid-cols-[19rem_1fr_17rem]">
      {/* Decorative only — the three panes below are all working surfaces
          (list to scan, thread to read, detail to reference), so none of
          them tilt; the atmosphere comes from these fixed blobs instead. */}
      <div
        aria-hidden
        className="ambient-glow absolute -top-20 left-1/3 -z-10 size-72 bg-brand opacity-[0.1]"
      />
      <div
        aria-hidden
        className="ambient-glow absolute -right-16 -bottom-16 -z-10 size-64 bg-brand-2 opacity-[0.1]"
      />

      {/* ---- list ---- */}
      <Card className="min-h-0 overflow-hidden p-0">
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Inbox</span>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{visibleConversations.length}</Badge>
              <Button
                size="icon-sm"
                variant={selectionMode ? 'default' : 'glass'}
                title={selectionMode ? 'Exit multi-select' : 'Select multiple conversations'}
                aria-label={selectionMode ? 'Exit multi-select' : 'Select multiple conversations'}
                aria-pressed={selectionMode}
                onClick={toggleSelectionMode}
              >
                <CheckSquare className="size-3.5" />
              </Button>
              <NewConversationDialog
                onCreated={(id) => {
                  reload()
                  handleSelect(id)
                }}
              />
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-subtle" />
            <Input
              value={nameQuery}
              onChange={(event) => setNameQuery(event.target.value)}
              placeholder="Search by contact name…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          {selectionMode && selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-brand-soft/60 px-2 py-1.5">
              <span className="text-[11px] font-medium text-brand-text">
                {selectedIds.size} selected
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Mark read"
                  disabled={bulkBusy}
                  onClick={() => handleBulk('read')}
                >
                  <MailOpen className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Mark unread"
                  disabled={bulkBusy}
                  onClick={() => handleBulk('unread')}
                >
                  <Mail className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Pin"
                  disabled={bulkBusy}
                  onClick={() => handleBulk('pin')}
                >
                  <Pin className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Unpin"
                  disabled={bulkBusy}
                  onClick={() => handleBulk('unpin')}
                >
                  <PinOff className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Delete"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={bulkBusy}
                  onClick={() => handleBulk('delete')}
                >
                  {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </div>
            </div>
          ) : null}
          {bulkError ? (
            <p className="text-[11px] text-destructive" role="alert">
              {bulkError}
            </p>
          ) : null}

          {allTags && allTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className={cn('pill', tagFilter === null ? 'pill-brand' : 'pill-muted')}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
                  className={cn(
                    'pill',
                    tag === tagFilter ? 'pill-brand' : 'pill-muted',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Separator />
        {visibleConversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No matches"
              description={`No contact name matches "${nameQuery.trim()}".`}
            />
          </div>
        ) : (
          <ThreadList
            conversations={visibleConversations}
            selectedId={selected.id}
            onSelect={handleSelect}
            onChanged={reload}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
          />
        )}
      </Card>

      {/* ---- thread ---- */}
      <Card className="min-h-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <Avatar>
            <AvatarImage src={undefined} alt="" />
            <AvatarFallback>{initials(selected.contact.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selected.contact.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {channelLabel(selected.contact.channel)}
              {selected.contact.phone_number
                ? ` · ${maskPhoneNumber(selected.contact.phone_number, selected.contact.channel)}`
                : ''}
            </p>
          </div>
          <ConversationStatusPill status={selected.status} />
          <Button
            variant="glass"
            size="icon-sm"
            title="Download transcript"
            aria-label="Download transcript"
            disabled={exportingId === selected.id}
            onClick={() => handleExportTranscript(selected)}
          >
            {exportingId === selected.id ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
          </Button>
          <AssignmentPicker
            endpoint={`/conversations/${selected.id}`}
            current={selected.assigned_agent}
            onAssigned={reload}
          />
        </div>

        {selected.handover_reason || stale ? (
          <div className="flex flex-col gap-2 px-5 pb-3">
            {selected.handover_reason ? (
              <HandoverNotice
                reason={selected.handover_reason}
                detail={selected.handover_detail}
                at={selected.handover_at}
              />
            ) : null}
            {stale ? (
              <ReplyWindowBanner lastIncomingAt={selected.last_incoming_at} />
            ) : null}
          </div>
        ) : null}

        <Separator />
        <Thread conversationId={selected.id} stale={stale} />
      </Card>

      {/* ---- detail ---- */}
      <Card className="hidden min-h-0 overflow-hidden p-0 xl:flex">
        <DetailPanel conversationId={selected.id} />
      </Card>
    </div>
  )
}
