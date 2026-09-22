import { Plus, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
import { nodeKindStyles, workflowNodeFallbackIcon, workflowNodeIcons } from '@/lib/workflowNodes'
import type {
  Agent,
  CatalogField,
  ConditionGroup,
  ConditionRule,
  User,
  WorkflowCatalog,
  WorkflowNodeConfig,
  WorkflowNodeData,
} from '@/lib/types'

/** Operators that take no right-hand value — showing an empty value box for
 * "is empty" would invite someone to fill it in and expect it to matter. */
const VALUELESS_OPERATORS = new Set([
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
])

function FieldInput({
  field,
  id,
  value,
  onChange,
  users,
  agents,
}: {
  field: CatalogField
  id: string
  value: unknown
  onChange: (value: string) => void
  users: User[]
  agents: Agent[]
}) {
  const text = value === undefined || value === null ? '' : String(value)

  if (field.type === 'select') {
    return (
      <Select value={text || String(field.default ?? '')} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'user' || field.type === 'agent') {
    const options =
      field.type === 'user'
        ? users.filter((user) => user.is_active).map((user) => ({ id: user.id, name: user.name }))
        : agents.map((agent) => ({ id: agent.id, name: agent.name }))
    return (
      <Select value={text} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Choose a${field.type === 'user' ? ' person' : 'n agent'}…`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'textarea') {
    return (
      <Textarea
        id={id}
        rows={3}
        className="text-xs"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <Input
      id={id}
      type={field.type === 'number' ? 'number' : 'text'}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function ConditionBuilder({
  config,
  onChange,
  catalog,
}: {
  config: WorkflowNodeConfig
  onChange: (config: WorkflowNodeConfig) => void
  catalog: WorkflowCatalog
}) {
  // A condition is always normalised to groups here, even when it arrived as
  // a bare `rules` list — one shape to edit beats two code paths, and the
  // engine accepts either.
  const groups: ConditionGroup[] = Array.isArray(config.groups)
    ? (config.groups as ConditionGroup[])
    : [
        {
          match: 'all',
          rules: Array.isArray(config.rules) ? (config.rules as ConditionRule[]) : [],
        },
      ]
  const outerMatch = (config.match as string) === 'any' ? 'any' : 'all'

  function commit(nextGroups: ConditionGroup[], nextOuterMatch = outerMatch) {
    onChange({ match: nextOuterMatch, groups: nextGroups })
  }

  function updateRule(groupIndex: number, ruleIndex: number, patch: Partial<ConditionRule>) {
    const next = groups.map((group, gi) =>
      gi !== groupIndex
        ? group
        : {
            ...group,
            rules: group.rules.map((rule, ri) => (ri === ruleIndex ? { ...rule, ...patch } : rule)),
          },
    )
    commit(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Match</Label>
        <Select value={outerMatch} onValueChange={(value) => commit(groups, value as 'all' | 'any')}>
          <SelectTrigger className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL groups</SelectItem>
            <SelectItem value="any">ANY group</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="glass-inset flex flex-col gap-2 rounded-lg p-2.5">
          <div className="flex items-center gap-2">
            <Select
              value={group.match === 'any' ? 'any' : 'all'}
              onValueChange={(value) =>
                commit(
                  groups.map((g, gi) =>
                    gi === groupIndex ? { ...g, match: value as 'all' | 'any' } : g,
                  ),
                )
              }
            >
              <SelectTrigger className="h-7 w-24 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">AND</SelectItem>
                <SelectItem value="any">OR</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">within this group</span>
            {groups.length > 1 ? (
              <button
                type="button"
                title="Remove group"
                onClick={() => commit(groups.filter((_, gi) => gi !== groupIndex))}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          {group.rules.map((rule, ruleIndex) => (
            <div key={ruleIndex} className="flex flex-col gap-1.5 rounded-md bg-black/10 p-2">
              <Select
                value={rule.field}
                onValueChange={(value) => updateRule(groupIndex, ruleIndex, { field: value })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Field…" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.condition_fields.map((field) => (
                    <SelectItem key={field.key} value={field.key}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1.5">
                <Select
                  value={rule.operator}
                  onValueChange={(value) => updateRule(groupIndex, ruleIndex, { operator: value })}
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.operators.map((operator) => (
                      <SelectItem key={operator.key} value={operator.key}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {!VALUELESS_OPERATORS.has(rule.operator) ? (
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={rule.value ?? ''}
                    placeholder="value"
                    onChange={(event) =>
                      updateRule(groupIndex, ruleIndex, { value: event.target.value })
                    }
                  />
                ) : null}

                <button
                  type="button"
                  title="Remove check"
                  onClick={() =>
                    commit(
                      groups.map((g, gi) =>
                        gi === groupIndex
                          ? { ...g, rules: g.rules.filter((_, ri) => ri !== ruleIndex) }
                          : g,
                      ),
                    )
                  }
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="glass"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              commit(
                groups.map((g, gi) =>
                  gi === groupIndex
                    ? {
                        ...g,
                        rules: [
                          ...g.rules,
                          {
                            field: catalog.condition_fields[0]?.key ?? '',
                            operator: 'equals',
                            value: '',
                          },
                        ],
                      }
                    : g,
                ),
              )
            }
          >
            <Plus className="size-3" />
            Add check
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="glass"
        size="sm"
        className="h-7 text-[11px]"
        onClick={() => commit([...groups, { match: 'all', rules: [] }])}
      >
        <Plus className="size-3" />
        Add group
      </Button>
    </div>
  )
}

export function NodePropertiesPanel({
  node,
  catalog,
  users,
  agents,
  onChange,
  onDelete,
  onClose,
}: {
  node: WorkflowNodeData
  catalog: WorkflowCatalog
  users: User[]
  agents: Agent[]
  onChange: (config: WorkflowNodeConfig) => void
  onDelete: () => void
  onClose: () => void
}) {
  const entry =
    node.kind === 'trigger'
      ? catalog.triggers.find((t) => t.key === node.type)
      : node.kind === 'action'
        ? catalog.actions.find((a) => a.key === node.type)
        : catalog.flow_nodes.find((f) => f.key === node.kind)

  const style = nodeKindStyles[node.kind]
  const Icon = workflowNodeIcons[node.type || node.kind] ?? workflowNodeFallbackIcon

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2.5 p-4">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${style.chip}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-wide text-foreground-subtle uppercase">
            {style.label}
          </p>
          <p className="truncate text-sm font-semibold">{entry?.label ?? node.type ?? node.kind}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close properties"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {entry?.description ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">{entry.description}</p>
      ) : null}

      <Separator />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {node.kind === 'condition' ? (
          <ConditionBuilder config={node.config} onChange={onChange} catalog={catalog} />
        ) : node.kind === 'delay' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delay-minutes">Wait for (minutes)</Label>
            <Input
              id="delay-minutes"
              type="number"
              min={0}
              value={String(node.config.minutes ?? '')}
              onChange={(event) => onChange({ ...node.config, minutes: event.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              The run pauses here and picks up from the next node once the wait is over.
            </p>
          </div>
        ) : node.kind === 'approval' ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="approval-title">Request title</Label>
              <Input
                id="approval-title"
                value={String(node.config.title ?? '')}
                placeholder="e.g. Approve refund for {{ contact.name }}"
                onChange={(event) => onChange({ ...node.config, title: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select
                value={String(node.config.priority ?? 'normal')}
                onValueChange={(value) => onChange({ ...node.config, priority: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['low', 'normal', 'high', 'urgent'].map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notify (optional)</Label>
              <Select
                value={String(node.config.user_id ?? '')}
                onValueChange={(value) => onChange({ ...node.config, user_id: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a person…" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((user) => user.is_active)
                    .map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Completing the request takes the <span className="text-success">true</span> branch;
              cancelling it takes <span className="text-destructive">false</span>.
            </p>
          </div>
        ) : entry?.fields?.length ? (
          <div className="flex flex-col gap-4">
            {entry.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                <FieldInput
                  field={field}
                  id={`field-${field.key}`}
                  value={node.config[field.key] ?? field.default}
                  users={users}
                  agents={agents}
                  onChange={(value) => onChange({ ...node.config, [field.key]: value })}
                />
              </div>
            ))}
            <p className="text-[11px] text-foreground-subtle">
              Text fields accept placeholders like{' '}
              <code className="rounded bg-black/20 px-1">{'{{ contact.name }}'}</code>.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">This node has nothing to configure.</p>
        )}
      </div>

      <Separator />
      <div className="p-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          Delete node
        </Button>
      </div>
    </div>
  )
}
