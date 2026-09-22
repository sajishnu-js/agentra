import {
  ArrowLeft,
  Check,
  Columns3,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Search,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/useApi'
import { useRequireDeleteConfirmation } from '@/hooks/useRequireDeleteConfirmation'
import { useTilt } from '@/hooks/useTilt'
import { api, ApiError } from '@/lib/api'
import { languageLabel, shortDate } from '@/lib/format'
import { kbIconFallback, kbIconMap, kbIconOptions } from '@/lib/kbIcons'
import { cn } from '@/lib/utils'
import type {
  KBChunk,
  KBColumn,
  KBDocument,
  KBTableDetail,
  KBTableRow as KBTableRowType,
  KBTableSummary,
  KnowledgeBaseSummary,
} from '@/lib/types'

const ACCEPTED_DOCUMENT_TYPES = '.pdf,.docx'

/** A spreadsheet view of one structured category. */
/** A column key derived from its label, never typed directly — mirrors how
 * the backend derives a table's slug from its name (see _unique_table_slug
 * in router.py). Guaranteed to match the backend's `^[a-z][a-z0-9_]*$`
 * pattern, so a column can never be rejected for a formatting reason a
 * non-technical user would find bewildering. */
function slugifyKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!base) return 'column'
  return /^[a-z]/.test(base) ? base : `col_${base}`
}

/** One search box, reused above the KB grid, the documents grid and the
 * table category tiles. All three lists are already fetched in full — this
 * filters client-side with no debouncing or server round trip. */
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  )
}

/** Escapes one CSV field per RFC 4180 — quoted (with an inner quote doubled)
 * only when the value itself contains a comma, quote or newline, so a plain
 * export stays easy to eyeball in a text editor. */
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A table's rows -> a CSV string, header = column labels in the table's own
 * order — generated entirely from the already-fetched KBTableDetail, so
 * exporting needs no backend endpoint of its own. */
function tableToCsv(table: KBTableDetail): string {
  const lines = [
    table.columns.map((column) => column.label),
    ...table.rows.map((row) => table.columns.map((column) => row.data[column.key] ?? '')),
  ]
  return lines.map((line) => line.map(csvEscape).join(',')).join('\r\n')
}

function downloadCsv(filename: string, content: string): void {
  // Leading BOM (built from its code point, not typed literally, so it can't
  // get silently mangled by an editor/encoding) so Excel opens this as UTF-8
  // rather than mojibake-ing any Arabic table values into another codepage.
  const BOM = String.fromCharCode(0xfeff)
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Minimal RFC-4180-ish CSV parser: comma-separated, double-quoted fields
 * ("" escapes a literal quote), quoted fields may embed commas or newlines.
 * Not a general-purpose CSV library — just enough to read back a file this
 * same page exports — so no new dependency for a feature this narrow. */
function parseCsvRows(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // Normalized away; the '\n' branch below closes the row either way.
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '')
}

type CsvImportPlan = {
  rows: Record<string, string>[]
  skippedColumns: string[]
}

/** Maps a CSV's header row onto `columns` by label, case-insensitively —
 * the label is what a human sees and would have exported originally, never
 * the internal `key`. A header that matches nothing is reported back in
 * `skippedColumns` rather than silently dropped; a data row that comes back
 * entirely blank (a stray trailing line) is skipped rather than imported as
 * an empty row. */
function planCsvImport(text: string, columns: KBColumn[]): CsvImportPlan {
  const table = parseCsvRows(text)
  if (table.length === 0) return { rows: [], skippedColumns: [] }

  const [header, ...dataRows] = table
  const keyByLabel = new Map(
    columns.map((column) => [column.label.trim().toLowerCase(), column.key]),
  )
  const headerKeys = header.map((cell) => keyByLabel.get(cell.trim().toLowerCase()) ?? null)
  const skippedColumns = header.filter(
    (cell, index) => headerKeys[index] === null && cell.trim() !== '',
  )

  const rows = dataRows
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const data: Record<string, string> = {}
      headerKeys.forEach((key, index) => {
        if (key) data[key] = cells[index] ?? ''
      })
      return data
    })

  return { rows, skippedColumns }
}

/** Add or edit one row — one input per column, so "give proper fields to
 * enter data" is literal rather than a single freeform JSON blob. */
function RowFormDialog({
  table,
  row,
  open,
  onOpenChange,
  onSaved,
}: {
  table: KBTableDetail
  row: KBTableRowType | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const initial: Record<string, string> = {}
    for (const column of table.columns) {
      initial[column.key] = row?.data[column.key] ?? ''
    }
    setValues(initial)
    setError(null)
    // table.columns is a fresh array identity on every parent render; keying
    // off table.id/row.id (not the array) avoids re-running on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id, table.id])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (row) {
        await api.patch(`/knowledge-base/tables/${table.id}/rows/${row.id}`, { data: values })
      } else {
        await api.post(`/knowledge-base/tables/${table.id}/rows`, { data: values })
      }
      onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this row')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {row ? 'Edit row' : 'Add row'} — {table.name}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {table.columns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This table has no columns yet — add one via Manage Columns first.
            </p>
          ) : (
            table.columns.map((column) => (
              <div key={column.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`row-field-${column.key}`}>{column.label}</Label>
                <Input
                  id={`row-field-${column.key}`}
                  value={values[column.key] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [column.key]: event.target.value }))
                  }
                />
              </div>
            ))
          )}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="glass" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || table.columns.length === 0}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Add, rename or remove columns — separate from the row editor since a
 * column change (unlike a row edit) affects every row in the table at once. */
function ManageColumnsDialog({
  table,
  open,
  onOpenChange,
  onChanged,
}: {
  table: KBTableDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({})
  const [newLabel, setNewLabel] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requireConfirmation = useRequireDeleteConfirmation()

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    const label = newLabel.trim()
    if (!label || busyKey) return
    setBusyKey('__new__')
    setError(null)
    try {
      await api.post(`/knowledge-base/tables/${table.id}/columns`, {
        key: slugifyKey(label),
        label,
      })
      setNewLabel('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add this column')
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRename(key: string) {
    const label = (labelDrafts[key] ?? '').trim()
    if (!label || busyKey) return
    setBusyKey(key)
    setError(null)
    try {
      await api.patch(`/knowledge-base/tables/${table.id}/columns/${encodeURIComponent(key)}`, {
        label,
      })
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not rename this column')
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDelete(key: string, label: string) {
    if (busyKey) return
    if (
      requireConfirmation &&
      !window.confirm(`Delete column "${label}"? Its data in every row is lost.`)
    )
      return
    setBusyKey(key)
    setError(null)
    try {
      await api.delete(`/knowledge-base/tables/${table.id}/columns/${encodeURIComponent(key)}`)
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this column')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLabelDrafts({})
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage columns — {table.name}</DialogTitle>
          <DialogDescription>
            Renaming a column changes only its header; deleting one removes that field from
            every row.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {table.columns.map((column) => {
            const draft = labelDrafts[column.key] ?? column.label
            const dirty = draft !== column.label
            return (
              <div key={column.key} className="flex items-center gap-2">
                <Input
                  value={draft}
                  onChange={(event) =>
                    setLabelDrafts((prev) => ({ ...prev, [column.key]: event.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busyKey === column.key || !dirty || !draft.trim()}
                  onClick={() => handleRename(column.key)}
                  title="Save label"
                >
                  {busyKey === column.key ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busyKey === column.key}
                  onClick={() => handleDelete(column.key, column.label)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="Delete column"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )
          })}
          {table.columns.length === 0 ? (
            <p className="text-xs text-muted-foreground">No columns yet — add one below.</p>
          ) : null}
        </div>

        <form onSubmit={handleAdd} className="flex items-end gap-2 border-t border-border pt-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-col-label">New column</Label>
            <Input
              id="new-col-label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="e.g. Approval Limit"
            />
          </div>
          <Button type="submit" size="sm" disabled={busyKey === '__new__' || !newLabel.trim()}>
            {busyKey === '__new__' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add
          </Button>
        </form>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="glass" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameTableDialog({
  table,
  open,
  onOpenChange,
  onSaved,
}: {
  table: KBTableDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(table.name)
  const [description, setDescription] = useState(table.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/knowledge-base/tables/${table.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      })
      onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save these changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName(table.name)
          setDescription(table.description ?? '')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename table</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-name">Name</Label>
            <Input id="table-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-description">Description</Label>
            <Textarea
              id="table-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="glass" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Bulk-create rows from a CSV via the existing single-row endpoint — one
 * POST per row, sequentially rather than in parallel, so `position`
 * (assigned server-side from the table's row count at the time of each
 * request) comes out in the same order as the file instead of racing
 * itself. Headers are matched to columns by label, not by internal key —
 * see planCsvImport — and the dialog stays open after a successful import to
 * report what happened rather than closing over a partial result. */
function ImportCsvDialog({
  table,
  open,
  onOpenChange,
  onImported,
}: {
  table: KBTableDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: string[] } | null>(null)

  function reset() {
    setFile(null)
    setError(null)
    setResult(null)
    setFileInputKey((key) => key + 1)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file || importing) return
    setImporting(true)
    setError(null)
    setResult(null)

    const text = await file.text()
    const { rows, skippedColumns } = planCsvImport(text, table.columns)
    if (rows.length === 0) {
      setError(
        skippedColumns.length > 0
          ? `No column in this CSV matches this table — found "${skippedColumns.join('", "')}", expected one of "${table.columns.map((c) => c.label).join('", "')}".`
          : 'This CSV has no data rows to import.',
      )
      setImporting(false)
      return
    }

    let imported = 0
    try {
      for (const row of rows) {
        await api.post(`/knowledge-base/tables/${table.id}/rows`, { data: row })
        imported += 1
      }
      setResult({ imported, skipped: skippedColumns })
      setFile(null)
      setFileInputKey((key) => key + 1)
      onImported()
    } catch (caught) {
      // Some rows may already be committed server-side even though this
      // throws — say so rather than reporting a bare error that implies
      // nothing happened.
      if (imported > 0) onImported()
      const message = caught instanceof ApiError ? caught.message : 'Could not import this file'
      setError(
        imported > 0
          ? `Imported ${imported} of ${rows.length} rows, then stopped: ${message}`
          : message,
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import rows — {table.name}</DialogTitle>
          <DialogDescription>
            A CSV whose header row matches this table's column labels (case-insensitive, any
            order). Columns that don't match are ignored; a matching column doesn't have to be
            present in every row.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-import-file">CSV file</Label>
            <Input
              key={fileInputKey}
              id="kb-import-file"
              type="file"
              accept=".csv"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setFile(event.target.files?.[0] ?? null)
                setError(null)
                setResult(null)
              }}
              required
            />
          </div>

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <p className="text-xs text-muted-foreground">
              Imported {result.imported} row{result.imported === 1 ? '' : 's'}.
              {result.skipped.length > 0
                ? ` Ignored column${result.skipped.length === 1 ? '' : 's'} not on this table: "${result.skipped.join('", "')}".`
                : ''}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="glass" size="sm" onClick={() => onOpenChange(false)}>
              {result ? 'Done' : 'Cancel'}
            </Button>
            <Button type="submit" size="sm" disabled={importing || !file}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateTableDialog({
  knowledgeBaseId,
  onCreated,
}: {
  knowledgeBaseId: string
  onCreated: (table: KBTableDetail) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const table = await api.post<KBTableDetail>('/knowledge-base/tables', {
        knowledge_base_id: knowledgeBaseId,
        name: name.trim(),
        description: description.trim() || undefined,
        columns: [],
      })
      onCreated(table)
      setOpen(false)
      setName('')
      setDescription('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this table')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="glass"
        size="sm"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <Plus className="size-3.5" />
        New Table
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New structured category</DialogTitle>
            <DialogDescription>
              A spreadsheet-like table, such as "Approval Limits" or "Locations". Add columns
              afterward.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-table-name">Name</Label>
              <Input
                id="new-table-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Approval Limits"
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-table-description">Description</Label>
              <Textarea
                id="new-table-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
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

function StructuredTable({ id, onMutated }: { id: string; onMutated: () => void }) {
  const { data, error, loading, reload } = useApi<KBTableDetail>(
    `/knowledge-base/tables/${id}`,
  )
  const [rowDialog, setRowDialog] = useState<{ row: KBTableRowType | null } | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deletingRow, setDeletingRow] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const requireConfirmation = useRequireDeleteConfirmation()

  // Guarded on `!data`, not bare `loading`/`error`: a mutation inside this
  // same table (add row, rename column…) calls this hook's own reload(),
  // which flips `loading` true for one tick. An unguarded early return here
  // would unmount this whole subtree — including whichever dialog the user
  // is mid-flow in (RowFormDialog, ManageColumnsDialog…) — right as their
  // action succeeds. Once real data exists, keep rendering it through a
  // background refresh instead of tearing the tree down.
  if (loading && !data) return <LoadingState label="Loading rows…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  async function handleDeleteRow(row: KBTableRowType) {
    if (requireConfirmation && !window.confirm('Delete this row? This cannot be undone.')) return
    setDeletingRow(row.id)
    setRowError(null)
    try {
      await api.delete(`/knowledge-base/tables/${data!.id}/rows/${row.id}`)
      reload()
      onMutated()
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : 'Could not delete this row')
    } finally {
      setDeletingRow(null)
    }
  }

  async function handleDeleteTable() {
    if (
      requireConfirmation &&
      !window.confirm(
        `Delete "${data!.name}" and all ${data!.rows.length} of its rows? This cannot be undone.`,
      )
    )
      return
    try {
      await api.delete(`/knowledge-base/tables/${data!.id}`)
      // Not a local reload: this table is gone, so refetching it would only
      // produce a 404. The parent's list reload picks a different table
      // (or the empty state) once this one is no longer in it.
      onMutated()
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : 'Could not delete this table')
    }
  }

  function handleExport() {
    downloadCsv(`${data!.slug}.csv`, tableToCsv(data!))
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <p className="text-sm font-semibold">{data.name}</p>
          <p className="text-xs text-muted-foreground">
            {data.rows.length} row{data.rows.length === 1 ? '' : 's'} · {data.columns.length}{' '}
            column{data.columns.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title="Rename table" onClick={() => setRenameOpen(true)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Manage columns" onClick={() => setColumnsOpen(true)}>
            <Columns3 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Export as CSV"
            onClick={handleExport}
            disabled={data.columns.length === 0}
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Import rows from CSV"
            onClick={() => setImportOpen(true)}
            disabled={data.columns.length === 0}
          >
            <Upload className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete table"
            onClick={handleDeleteTable}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="sm" onClick={() => setRowDialog({ row: null })} disabled={data.columns.length === 0}>
            <Plus className="size-3.5" />
            Add Row
          </Button>
        </div>
      </div>

      {rowError ? (
        <p className="px-4 pt-3 text-xs text-destructive" role="alert">
          {rowError}
        </p>
      ) : null}

      {data.columns.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No columns yet"
            description="Use Manage Columns to define what this category tracks."
          />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No rows yet" description="Add entries to this category." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">#</TableHead>
                {data.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="text-right text-xs tabular-nums text-foreground-subtle">
                    {index + 1}
                  </TableCell>
                  {data.columns.map((column, columnIndex) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        'whitespace-nowrap',
                        columnIndex === 0 ? 'font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {row.data[column.key] || '—'}
                    </TableCell>
                  ))}
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Edit row"
                      onClick={() => setRowDialog({ row })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete row"
                      disabled={deletingRow === row.id}
                      onClick={() => handleDeleteRow(row)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deletingRow === row.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {rowDialog ? (
        <RowFormDialog
          table={data}
          row={rowDialog.row}
          open
          onOpenChange={(next) => !next && setRowDialog(null)}
          onSaved={() => {
            reload()
            onMutated()
          }}
        />
      ) : null}
      <ManageColumnsDialog
        table={data}
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        onChanged={() => {
          reload()
          onMutated()
        }}
      />
      <RenameTableDialog
        table={data}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onSaved={() => {
          reload()
          onMutated()
        }}
      />
      <ImportCsvDialog
        table={data}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          reload()
          onMutated()
        }}
      />
    </>
  )
}

/** One category switcher — a small, discrete, individually-clickable glass
 *  tile much like KnowledgeBaseTile below, so it earns the same tilt-3d
 *  treatment (at a lower strength: rectangular and tab-like, not a showcase
 *  card, so the motion should read as a light lift rather than a flourish). */
function CategoryButton({
  table,
  isActive,
  onSelect,
}: {
  table: KBTableSummary
  isActive: boolean
  onSelect: () => void
}) {
  const tilt = useTilt<HTMLButtonElement>(6)

  return (
    <button
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      type="button"
      onClick={onSelect}
      aria-current={isActive}
      className={cn(
        'tilt-3d glass glass-sheen flex flex-col gap-1 rounded-xl p-4 text-left transition-all',
        isActive
          ? 'border-brand/50 shadow-glow'
          : 'hover:bg-glass-hover hover:border-brand/30',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Table2
            className={cn(
              'size-4',
              isActive ? 'text-brand-text' : 'text-muted-foreground',
            )}
          />
          {table.name}
        </span>
        <Badge variant={isActive ? 'default' : 'secondary'}>
          {table.row_count}
        </Badge>
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {table.description}
      </span>
    </button>
  )
}

function StructuredTables({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { data, error, loading, reload } = useApi<KBTableSummary[]>(
    `/knowledge-base/tables?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`,
  )
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Same reasoning as StructuredTable above: a mutation inside the active
  // table calls onMutated(), which reloads this list too (to keep row-count
  // badges and names fresh) — guard on `!data` so that reload never tears
  // down the still-open detail pane underneath it.
  if (loading && !data) return <LoadingState label="Loading categories…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateTableDialog
          knowledgeBaseId={knowledgeBaseId}
          onCreated={(table) => {
            reload()
            setActiveSlug(table.slug)
          }}
        />
      </div>

      {!data?.length ? (
        <Card>
          <EmptyState
            title="No structured categories"
            description="Create one to track things like Doctors, Treatments or Approval Limits."
          />
        </Card>
      ) : (
        (() => {
          // Filtered for which tiles are shown, but the active table itself
          // is still looked up in the full, unfiltered list — narrowing the
          // search shouldn't close whichever table's detail pane is open.
          const active = data.find((table) => table.slug === activeSlug) ?? data[0]
          const query = search.trim().toLowerCase()
          const filtered = query
            ? data.filter(
                (table) =>
                  table.name.toLowerCase().includes(query) ||
                  (table.description ?? '').toLowerCase().includes(query),
              )
            : data
          return (
            <>
              <SearchField value={search} onChange={setSearch} placeholder="Search categories…" />

              {filtered.length ? (
                // Category cards, not a flat list — each one is a glass tile.
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {filtered.map((table) => (
                    <CategoryButton
                      key={table.id}
                      table={table}
                      isActive={table.slug === active.slug}
                      onSelect={() => setActiveSlug(table.slug)}
                    />
                  ))}
                </div>
              ) : (
                <Card>
                  <EmptyState title="No matches" description={`No category matches "${search}".`} />
                </Card>
              )}

              <Card className="p-0">
                <StructuredTable key={active.id} id={active.id} onMutated={reload} />
              </Card>
            </>
          )
        })()
      )}
    </div>
  )
}

/** Upload a new document into this knowledge base — the trigger for the
 * whole ingest pipeline (parse → chunk → embed) from the UI rather than only
 * the CLI folder tool. */
function UploadDocumentDialog({
  knowledgeBaseId,
  onUploaded,
}: {
  knowledgeBaseId: string
  onUploaded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file || saving) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('knowledge_base_id', knowledgeBaseId)
      form.append('file', file)
      await api.upload('/knowledge-base/documents', form)
      onUploaded()
      setOpen(false)
      setFile(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not upload this file')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setFile(null)
          setError(null)
          setOpen(true)
        }}
      >
        <Upload className="size-4" />
        Upload Document
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a document</DialogTitle>
            <DialogDescription>
              A .docx or .pdf file — its text is extracted, chunked and embedded so the
              agent assigned to this knowledge base can answer from it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-upload-file">File</Label>
              <Input
                id="kb-upload-file"
                type="file"
                accept={ACCEPTED_DOCUMENT_TYPES}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setFile(event.target.files?.[0] ?? null)
                }
                required
              />
              {file ? (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              ) : null}
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
              <Button type="submit" size="sm" disabled={saving || !file}>
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  'Upload'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Read-only view of what the pipeline actually extracted — the ground
 * truth of what the agent can answer from, since the original file's
 * formatting is not what gets embedded. */
function ViewChunksDialog({ document, open, onOpenChange }: {
  document: KBDocument
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, error, loading } = useApi<KBChunk[]>(
    open ? `/knowledge-base/documents/${document.id}/chunks` : null,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{document.title}</DialogTitle>
          <DialogDescription>
            Extracted content, as the agent actually sees it — {document.chunk_count} chunk
            {document.chunk_count === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <LoadingState label="Loading extracted content…" />
        ) : error ? (
          <ErrorState error={error} />
        ) : !data?.length ? (
          <EmptyState title="No extracted content" description="This document has no chunks yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {data.map((chunk) => (
              <div key={chunk.id} className="glass rounded-lg p-3 text-sm">
                <p className="mb-1.5 text-[11px] font-medium tracking-wide text-foreground-subtle uppercase">
                  Chunk {chunk.chunk_index + 1}
                </p>
                <p className="whitespace-pre-wrap text-muted-foreground">{chunk.content}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditDocumentDialog({
  document,
  open,
  onOpenChange,
  onSaved,
}: {
  document: KBDocument
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(document.title)
  const [language, setLanguage] = useState(document.language ?? 'unset')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/knowledge-base/documents/${document.id}`, {
        title: title.trim(),
        language: language === 'unset' ? null : language,
      })
      onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save these changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTitle(document.title)
          setLanguage(document.language ?? 'unset')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit document</DialogTitle>
          <DialogDescription>Metadata only — the extracted content stays as-is.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Unspecified</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">Arabic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="glass" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DocumentCard({
  document,
  onChanged,
}: {
  document: KBDocument
  onChanged: () => void
}) {
  const tilt = useTilt<HTMLDivElement>(8)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const requireConfirmation = useRequireDeleteConfirmation()

  async function handleReplace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // lets the same filename be picked again later
    if (!file) return
    setReplacing(true)
    setActionError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.upload(`/knowledge-base/documents/${document.id}/replace`, form)
      onChanged()
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not replace this file')
    } finally {
      setReplacing(false)
    }
  }

  async function handleDelete() {
    if (requireConfirmation && !window.confirm(`Delete "${document.title}"? This cannot be undone.`))
      return
    setDeleting(true)
    setActionError(null)
    try {
      await api.delete(`/knowledge-base/documents/${document.id}`)
      onChanged()
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not delete this document')
      setDeleting(false)
    }
  }

  const busy = replacing || deleting

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d gap-0 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-text">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium">{document.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {document.source_type.toUpperCase()} · {languageLabel(document.language)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="size-3.5" />
          {document.chunk_count} chunk{document.chunk_count === 1 ? '' : 's'}
        </span>
        <span className="text-xs text-foreground-subtle">{shortDate(document.uploaded_at)}</span>
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-border pt-3">
        <Button variant="ghost" size="icon-sm" title="View extracted content" onClick={() => setViewOpen(true)}>
          <Layers className="size-3.5" />
        </Button>
        {document.file_url ? (
          <Button variant="ghost" size="icon-sm" title="View original file" asChild>
            <a href={document.file_url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" title="Rename / edit" onClick={() => setEditOpen(true)}>
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Replace file"
          disabled={busy}
          onClick={() => replaceInputRef.current?.click()}
        >
          {replacing ? <Loader2 className="size-3.5 animate-spin" /> : <Repeat className="size-3.5" />}
        </Button>
        <input
          ref={replaceInputRef}
          type="file"
          accept={ACCEPTED_DOCUMENT_TYPES}
          className="hidden"
          onChange={handleReplace}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete"
          disabled={busy}
          onClick={handleDelete}
          className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>

      {actionError ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <ViewChunksDialog document={document} open={viewOpen} onOpenChange={setViewOpen} />
      <EditDocumentDialog
        document={document}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onChanged}
      />
    </Card>
  )
}

function Documents({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { data, error, loading, reload } = useApi<KBDocument[]>(
    `/knowledge-base/documents?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`,
  )
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const filtered = query ? (data ?? []).filter((document) => document.title.toLowerCase().includes(query)) : data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <UploadDocumentDialog knowledgeBaseId={knowledgeBaseId} onUploaded={reload} />
      </div>

      {loading && !data ? (
        <LoadingState label="Loading documents…" />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            title="No documents uploaded"
            description="Upload a PDF or Word file to give the agent something to read."
          />
        </Card>
      ) : (
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Search documents…" />

          {filtered?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((document) => (
                <DocumentCard key={document.id} document={document} onChanged={reload} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState title="No matches" description={`No document matches "${search}".`} />
            </Card>
          )}

          <p className="text-xs text-foreground-subtle">
            {data.length} documents ·{' '}
            {data.reduce((sum, document) => sum + document.chunk_count, 0)} embedded chunks, 1024
            dimensions each
          </p>
        </>
      )}
    </div>
  )
}

/** One tile in the knowledge-base picker grid. */
function KnowledgeBaseTile({
  kb,
  onSelect,
}: {
  kb: KnowledgeBaseSummary
  onSelect: () => void
}) {
  const Icon = kbIconMap[kb.icon] ?? kbIconMap[kbIconFallback]
  const tilt = useTilt<HTMLButtonElement>(8)
  const usedBy =
    kb.agents.length > 0
      ? `Used by ${kb.agents.map((a) => a.name).join(', ')}`
      : 'Not assigned to any agent'

  return (
    <button
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      type="button"
      onClick={onSelect}
      className="glass glass-sheen tilt-3d flex flex-col gap-0 rounded-2xl p-5 text-left transition-all hover:bg-glass-hover hover:border-brand/30"
    >
      <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-text">
        <Icon className="size-5" />
      </span>
      <p className="mt-4 text-sm font-semibold">{kb.name}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {kb.description || 'No description yet.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[11px] text-foreground-subtle">
        <span>
          {kb.document_count} doc{kb.document_count === 1 ? '' : 's'}
        </span>
        <span>
          {kb.table_count} table{kb.table_count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-2 line-clamp-1 text-[11px] text-foreground-subtle">{usedBy}</p>
    </button>
  )
}

/** Form for creating a new knowledge base — a name, an optional blurb, and one of a
 * fixed set of icons. */
function CreateKnowledgeBaseDialog({
  onCreated,
}: {
  onCreated: (kb: KnowledgeBaseSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string>(kbIconOptions[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setDescription('')
    setIcon(kbIconOptions[0])
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const kb = await api.post<KnowledgeBaseSummary>('/knowledge-base/collections', {
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
      })
      onCreated(kb)
      setOpen(false)
      reset()
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not create knowledge base',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Plus className="size-4" />
        Add Knowledge Base
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New knowledge base</DialogTitle>
            <DialogDescription>
              Group documents and structured tables an agent can draw answers from.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-name">Name</Label>
              <Input
                id="kb-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Dental FAQs"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-description">Description</Label>
              <Textarea
                id="kb-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this knowledge base covers"
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Icon</Label>
              <div className="grid grid-cols-4 gap-2">
                {kbIconOptions.map((key) => {
                  const Icon = kbIconMap[key]
                  const active = icon === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setIcon(key)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center justify-center rounded-lg border p-2.5 transition-colors',
                        active
                          ? 'border-brand/60 bg-brand-soft text-brand-text'
                          : 'border-input text-muted-foreground hover:border-ring/40 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  )
                })}
              </div>
            </div>

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={() => setOpen(false)}
              >
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

export function KnowledgeBase() {
  const [selectedKb, setSelectedKb] = useState<KnowledgeBaseSummary | null>(null)
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useApi<KnowledgeBaseSummary[]>(
    '/knowledge-base/collections',
  )

  if (selectedKb) {
    return (
      <div className="relative flex flex-col gap-4 overflow-hidden">
        <div
          aria-hidden
          className="ambient-glow absolute -top-16 -left-16 -z-10 size-64 bg-brand-2 opacity-[0.09]"
        />
        <div className="flex flex-col gap-3">
          <Button
            variant="glass"
            size="sm"
            className="self-start"
            onClick={() => setSelectedKb(null)}
          >
            <ArrowLeft className="size-3.5" />
            All knowledge bases
          </Button>
          <div>
            <p className="text-lg font-semibold">{selectedKb.name}</p>
            {selectedKb.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedKb.description}
              </p>
            ) : null}
          </div>
        </div>

        <Tabs defaultValue="structured" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="structured">
              <Table2 className="size-3.5" />
              Structured Tables
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="size-3.5" />
              Documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="structured">
            <StructuredTables knowledgeBaseId={selectedKb.id} />
          </TabsContent>
          <TabsContent value="documents">
            <Documents knowledgeBaseId={selectedKb.id} />
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden">
      <div
        aria-hidden
        className="ambient-glow absolute -top-16 right-0 -z-10 size-60 bg-brand opacity-[0.1]"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">Knowledge bases</p>
          <p className="text-sm text-muted-foreground">
            Group documents and tables that agents can answer from.
          </p>
        </div>
        <CreateKnowledgeBaseDialog
          onCreated={(kb) => {
            reload()
            setSelectedKb(kb)
          }}
        />
      </div>

      {loading ? (
        <LoadingState label="Loading knowledge bases…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            title="No knowledge bases yet"
            description="Create one to start grouping documents and tables for your agents."
          />
        </Card>
      ) : (
        (() => {
          const query = search.trim().toLowerCase()
          const filtered = query
            ? data.filter(
                (kb) =>
                  kb.name.toLowerCase().includes(query) ||
                  (kb.description ?? '').toLowerCase().includes(query),
              )
            : data
          return (
            <>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search knowledge bases…"
              />
              {filtered.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((kb) => (
                    <KnowledgeBaseTile key={kb.id} kb={kb} onSelect={() => setSelectedKb(kb)} />
                  ))}
                </div>
              ) : (
                <Card>
                  <EmptyState
                    title="No matches"
                    description={`No knowledge base matches "${search}".`}
                  />
                </Card>
              )}
            </>
          )
        })()
      )}
    </div>
  )
}
