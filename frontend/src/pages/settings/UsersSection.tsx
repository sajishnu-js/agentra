import { Plus, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/hooks/useApi'
import { useRequireDeleteConfirmation } from '@/hooks/useRequireDeleteConfirmation'
import { api, ApiError } from '@/lib/api'
import { initials } from '@/lib/format'
import type { User, UserRole } from '@/lib/types'
import { SectionHeader } from '@/pages/settings/shared'

// Mirrors auth/permissions.py:GRANTABLE_PERMISSIONS exactly — what a Super
// Admin can hand to a specific admin. manage_login_requirement and
// manage_admins are deliberately absent: never grantable, super_admin only.
const PERMISSION_LABELS: Record<string, string> = {
  manage_users: 'Manage users (agent-tier only)',
  manage_agents: 'Manage AI agents',
  manage_knowledge_base: 'Manage knowledge bases',
  manage_workspace_settings: 'Manage workspace settings',
  manage_security: 'Manage security settings',
  manage_integrations: 'View integration status',
  view_audit_log: 'View audit log',
}
const ALL_GRANTABLE = Object.keys(PERMISSION_LABELS)

function PermissionsChecklist({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {ALL_GRANTABLE.map((permission) => (
        <label key={permission} className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-[var(--brand)]"
            checked={value.includes(permission)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, permission]
                  : value.filter((p) => p !== permission),
              )
            }
          />
          {PERMISSION_LABELS[permission]}
        </label>
      ))}
    </div>
  )
}

function PermissionsDialog({
  person,
  onChanged,
}: {
  person: User
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(person.granted_permissions)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/users/${person.id}`, { granted_permissions: draft })
      onChanged()
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update permissions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDraft(person.granted_permissions)
      }}
    >
      <Button type="button" variant="glass" size="sm" onClick={() => setOpen(true)}>
        Permissions ({person.granted_permissions.length})
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{person.name}'s permissions</DialogTitle>
          <DialogDescription>
            What this admin can do in Settings, beyond the day-to-day work every role gets.
          </DialogDescription>
        </DialogHeader>
        <PermissionsChecklist value={draft} onChange={setDraft} />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="glass" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateUserDialog({ isSuperAdmin, onCreated }: { isSuperAdmin: boolean; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('agent')
  const [grants, setGrants] = useState<string[]>(ALL_GRANTABLE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setEmail('')
    setRole('agent')
    setGrants(ALL_GRANTABLE)
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !email.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.post<User>('/users', {
        name: name.trim(),
        email: email.trim(),
        role,
        granted_permissions: role === 'admin' ? grants : undefined,
      })
      onCreated()
      setOpen(false)
      reset()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add this person')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Plus className="size-4" />
        Add user
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a workspace user</DialogTitle>
            <DialogDescription>
              They sign in with this email — no password to set (see Account settings).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)} disabled={!isSuperAdmin}>
                <SelectTrigger id="new-user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent — day-to-day work only</SelectItem>
                  {isSuperAdmin ? (
                    <>
                      <SelectItem value="admin">Admin — Settings, Agents, Knowledge Base</SelectItem>
                      <SelectItem value="super_admin">Super Admin — full system access</SelectItem>
                    </>
                  ) : null}
                </SelectContent>
              </Select>
              {!isSuperAdmin ? (
                <p className="text-[11px] text-foreground-subtle">
                  Only a Super Admin can create an Admin or Super Admin account.
                </p>
              ) : null}
            </div>

            {role === 'admin' ? (
              <div className="flex flex-col gap-1.5">
                <Label>Permissions</Label>
                <PermissionsChecklist value={grants} onChange={setGrants} />
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="glass" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !name.trim() || !email.trim()}>
                {saving ? 'Adding…' : 'Add user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function UserRow({
  person,
  isSelf,
  isSuperAdmin,
  requireConfirmation,
  onChanged,
}: {
  person: User
  isSelf: boolean
  isSuperAdmin: boolean
  requireConfirmation: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // A plain admin (not super_admin) can only touch agent-tier accounts —
  // matching the backend's own _require_super_admin_for_admin_tier guard.
  // Editing your own row is also blocked here for role/active/delete: the
  // API already refuses self-delete, and self-demotion is how you'd
  // accidentally strand the workspace, so it isn't offered as a click.
  const canManageThisRow = isSuperAdmin || (person.role === 'agent' && !isSelf)

  async function updateRole(role: UserRole) {
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/users/${person.id}`, { role })
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change role')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(is_active: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/users/${person.id}/active?is_active=${is_active}`, {})
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update this account')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/users/${person.id}`)
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this account')
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarImage src={person.avatar_url ?? undefined} alt={person.name} />
            <AvatarFallback className="text-[11px]">{initials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              {person.name}
              {isSelf ? <span className="text-xs text-foreground-subtle">(you)</span> : null}
              {person.role === 'super_admin' ? (
                <ShieldCheck className="size-3.5 text-brand-text" aria-label="Super Admin" />
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{person.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{person.job_title ?? '—'}</TableCell>
      <TableCell>
        <Select
          value={person.role}
          onValueChange={(value) => void updateRole(value as UserRole)}
          disabled={busy || !canManageThisRow}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            {isSuperAdmin ? <SelectItem value="super_admin">Super Admin</SelectItem> : null}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {person.role === 'admin' ? (
          isSuperAdmin ? (
            <PermissionsDialog person={person} onChanged={onChanged} />
          ) : (
            <span className="text-xs text-muted-foreground">
              {person.granted_permissions.length} granted
            </span>
          )
        ) : (
          <span className="text-xs text-foreground-subtle">
            {person.role === 'super_admin' ? 'All' : '—'}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Switch
          checked={person.is_active}
          disabled={busy || !canManageThisRow}
          onCheckedChange={(checked) => void toggleActive(checked)}
        />
      </TableCell>
      <TableCell className="text-right">
        {!canManageThisRow ? null : confirmingDelete ? (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-xs text-muted-foreground">Delete?</span>
            <Button size="sm" variant="glass" disabled={busy} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
              Confirm
            </Button>
          </div>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || isSelf}
            title={isSelf ? "You can't delete your own account" : 'Delete user'}
            onClick={() => (requireConfirmation ? setConfirmingDelete(true) : void handleDelete())}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        {error ? <p className="mt-1 text-right text-[11px] text-destructive">{error}</p> : null}
      </TableCell>
    </TableRow>
  )
}

export function UsersSection() {
  const { user: me } = useAuth()
  const isSuperAdmin = me?.role === 'super_admin'
  const { data, error, loading, reload } = useApi<User[]>('/users')
  // Fetched once here rather than per-row — a workspace can have many users.
  const requireConfirmation = useRequireDeleteConfirmation()

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border p-5 pb-4">
        <SectionHeader
          icon={UsersIcon}
          title="Users & roles"
          description="Who has access to this workspace, and what they can do."
        />
        <CreateUserDialog isSuperAdmin={isSuperAdmin} onCreated={reload} />
      </div>

      {/* Guarded on `!data`, not bare `loading`/`error`: each UserRow's own
          mutation (role change, active toggle, delete) calls this list's
          reload() right after succeeding. An unguarded switch here would
          unmount every row — including another row's in-progress "confirm
          delete" or error message — the instant any one row's action
          succeeds. */}
      {loading && !data ? (
        <LoadingState label="Loading staff…" />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="No one here yet" description="Add the first workspace user." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((person) => (
                <UserRow
                  key={person.id}
                  person={person}
                  isSelf={person.id === me?.id}
                  isSuperAdmin={isSuperAdmin}
                  requireConfirmation={requireConfirmation}
                  onChanged={reload}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
