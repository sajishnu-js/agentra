import { Camera, Loader2, Trash2, Upload, UserRound } from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SaveBar, SectionHeader, SettingsField } from '@/pages/settings/shared'
import { api, ApiError } from '@/lib/api'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { User } from '@/lib/types'

const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

// Deliberately a short, curated list rather than all ~400 IANA zones — the
// clinic is UAE-based, so its own zone plus the counterparts a business here
// most often deals with, not an exhaustive picker.
const WORKSPACE_DEFAULT_TIMEZONE = '__workspace_default__'
const TIMEZONE_OPTIONS = [
  { value: 'Asia/Dubai', label: 'Dubai (Asia/Dubai)' },
  { value: 'Asia/Riyadh', label: 'Riyadh (Asia/Riyadh)' },
  { value: 'Asia/Kolkata', label: 'India (Asia/Kolkata)' },
  { value: 'Asia/Karachi', label: 'Pakistan (Asia/Karachi)' },
  { value: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { value: 'Europe/London', label: 'London (Europe/London)' },
  { value: 'Europe/Berlin', label: 'Berlin (Europe/Berlin)' },
  { value: 'America/New_York', label: 'New York (America/New_York)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (America/Los_Angeles)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia/Sydney)' },
  { value: 'UTC', label: 'UTC' },
]

type Draft = Pick<User, 'name' | 'avatar_url' | 'job_title' | 'phone' | 'timezone'>

function toDraft(user: User): Draft {
  return {
    name: user.name,
    avatar_url: user.avatar_url,
    job_title: user.job_title,
    phone: user.phone,
    timezone: user.timezone,
  }
}

/** Who you are — the personal-identity half of self-service account editing.
 * See AccountSection for the credential/danger-zone half. */
export function ProfileSection() {
  const { user, refreshUser } = useAuth()
  const initial = useMemo(() => (user ? toDraft(user) : null), [user])
  const [draft, setDraft] = useState<Draft | null>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previousInitialRef = useRef<Draft | null>(initial)

  // A photo upload refreshes `user` (and so `initial`) independently of the
  // rest of this form's own Save — a blind `setDraft(initial)` here would
  // silently discard an in-progress edit to name/job title/phone the moment
  // someone also uploaded a new photo. Adopt the fresh value field-by-field,
  // but only for a field the draft hasn't actively diverged on since the
  // last time `initial` changed; anything the user is mid-editing survives.
  useEffect(() => {
    // Read the ref into a local BEFORE queueing the update. A setState
    // updater does not run synchronously — it runs on the next render, by
    // which point the assignment at the end of this effect has already
    // moved the ref on to the new `initial`. Reading it inside the updater
    // therefore compared the draft against the *new* value, so the
    // "unchanged since last time" test was only ever true when the value
    // already matched — and a genuinely new one (an uploaded avatar) was
    // never adopted. The form silently ignored every external change.
    const previous = previousInitialRef.current
    previousInitialRef.current = initial

    setDraft((current) => {
      if (!initial) return null
      if (!current) return initial
      // Untyped intermediate: TypeScript can't verify per-key correspondence
      // through a generic keyof loop, but this only ever copies a value
      // between two objects of the same Draft shape.
      const merged: Record<string, unknown> = { ...current }
      for (const key of Object.keys(initial) as (keyof Draft)[]) {
        if (!previous || current[key] === previous[key]) {
          merged[key] = initial[key]
        }
      }
      return merged as Draft
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  if (!user || !draft) return null

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await api.patch('/users/me', {
        name: draft.name.trim(),
        avatar_url: draft.avatar_url?.trim() || null,
        job_title: draft.job_title?.trim() || null,
        phone: draft.phone?.trim() || null,
        timezone: draft.timezone,
      })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your profile')
    } finally {
      setSaving(false)
    }
  }

  // Immediate, not staged with the rest of the form: matches how a file
  // upload behaves everywhere else in this app (a document replace, an
  // attachment send) — the action completes for real the moment you pick a
  // file, rather than waiting on the surrounding form's own Save.
  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingPhoto(true)
    setPhotoError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.upload('/users/me/avatar', form)
      await refreshUser()
    } catch (caught) {
      setPhotoError(caught instanceof ApiError ? caught.message : 'Could not upload this photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  /** Clears the photo immediately, like the upload it mirrors — not staged
   * behind the form's Save, which would leave the avatar showing after you
   * had visibly removed it. */
  async function handleRemovePhoto() {
    setUploadingPhoto(true)
    setPhotoError(null)
    try {
      await api.patch('/users/me', { avatar_url: null })
      await refreshUser()
      setDraft((current) => (current ? { ...current, avatar_url: null } : current))
    } catch (caught) {
      setPhotoError(caught instanceof ApiError ? caught.message : 'Could not remove this photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={UserRound}
        title="Profile"
        description="Your name, photo and contact details — visible to the rest of the workspace."
      />

      <div className="flex flex-col gap-5 p-5">
        {/* Profile photo. An explicit, labelled block rather than a hover
            affordance hidden on the avatar itself — uploading a picture is a
            thing people come to this page to do, so it should be visible
            without having to discover it by pointing at the right circle. */}
        <div className="glass-inset flex flex-col gap-4 rounded-xl p-4 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            title="Upload a profile picture"
            className="group relative size-20 shrink-0 self-start rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            <Avatar className="size-20">
              <AvatarImage src={draft.avatar_url ?? undefined} alt={draft.name} />
              <AvatarFallback className="text-xl">
                {initials(draft.name || user.name)}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white transition-opacity',
                uploadingPhoto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {uploadingPhoto ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <Camera className="size-6" />
              )}
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_AVATAR_TYPES}
            className="hidden"
            onChange={handlePhotoUpload}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Profile picture</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                PNG, JPEG, WebP or GIF, up to 5 MB. Square images look best — everyone
                else sees this beside your name.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="glass"
                disabled={uploadingPhoto}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingPhoto ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {draft.avatar_url ? 'Replace photo' : 'Upload photo'}
              </Button>
              {draft.avatar_url ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={uploadingPhoto}
                  onClick={handleRemovePhoto}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              ) : null}
            </div>
            {photoError ? (
              <p className="text-xs text-destructive" role="alert">
                {photoError}
              </p>
            ) : null}
          </div>
        </div>

        <SettingsField
          label="Or use an image URL"
          htmlFor="profile-avatar"
          hint="Point at an already-hosted image instead of uploading one. Saved with the rest of the form."
        >
          <Input
            id="profile-avatar"
            value={draft.avatar_url ?? ''}
            onChange={(event) => setDraft({ ...draft, avatar_url: event.target.value })}
            placeholder="https://…"
          />
        </SettingsField>

        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label="Name" htmlFor="profile-name">
            <Input
              id="profile-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
          </SettingsField>
          <SettingsField label="Job title" htmlFor="profile-title">
            <Input
              id="profile-title"
              value={draft.job_title ?? ''}
              onChange={(event) => setDraft({ ...draft, job_title: event.target.value })}
              placeholder="e.g. Customer Support Specialist"
            />
          </SettingsField>
          <SettingsField label="Phone" htmlFor="profile-phone">
            <Input
              id="profile-phone"
              value={draft.phone ?? ''}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              placeholder="+971 5…"
            />
          </SettingsField>
          <SettingsField
            label="Timezone"
            htmlFor="profile-timezone"
            hint="Used to show times to you personally — leave on workspace default to see the same times everyone else does."
          >
            <Select
              value={draft.timezone ?? WORKSPACE_DEFAULT_TIMEZONE}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  timezone: value === WORKSPACE_DEFAULT_TIMEZONE ? null : value,
                })
              }
            >
              <SelectTrigger id="profile-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKSPACE_DEFAULT_TIMEZONE}>Workspace default (—)</SelectItem>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsField>
          <SettingsField label="Role">
            <Input
              value={
                user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'Agent'
              }
              disabled
            />
          </SettingsField>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        error={error}
        saved={saved}
        onSave={handleSave}
        onReset={() => setDraft(initial)}
      />
    </Card>
  )
}
