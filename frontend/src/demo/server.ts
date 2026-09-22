/**
 * The stand-in backend used by the public demo build.
 *
 * The deployed portfolio site is frontend-only — there is no FastAPI process,
 * no Postgres and no Redis behind it. Rather than let every panel fall into an
 * error state, `request()` in `lib/api.ts` hands the call here instead, and
 * this module answers it from a snapshot of real API responses.
 *
 * The fixtures are not hand-written. They were captured from the running local
 * API against the seeded (entirely synthetic) database, so every response has
 * exactly the shape the real endpoint returns — which is the only reason the
 * pages render without special-casing anything.
 *
 * Writes are honoured in memory: creating an agent, renaming a workflow or
 * sending a test message all update the store and stay updated for the rest of
 * the session. Nothing persists past a page reload, which is the honest
 * behaviour for a demo and avoids implying a database that isn't there.
 */

import { ApiError } from '@/lib/api'

type Json = Record<string, unknown>

/** The mutable copy. Loaded lazily so the ~194 KB of fixtures becomes its own
 * chunk and never touches the bundle of a normal (non-demo) build. */
let store: Record<string, unknown> | null = null

async function getStore(): Promise<Record<string, unknown>> {
  if (store === null) {
    const loaded = (await import('./fixtures.json')).default as Record<string, unknown>
    // Deep clone: the imported module object is shared and frozen in some
    // bundler configurations, and writes below mutate this freely.
    store = structuredClone(loaded)
  }
  return store
}

/** Network feel. Without it every list snaps in instantly and the loading and
 * skeleton states — which are real work in this UI — would never be visible. */
function latency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 180))
}

function stripQuery(path: string): string {
  const i = path.indexOf('?')
  return i === -1 ? path : path.slice(0, i)
}

function uuid(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Find a fixture for a GET.
 *
 * Tries the full path first so query-specific captures (the analytics ranges)
 * win, then falls back to the bare path. A miss returns `undefined` and the
 * caller decides the empty shape, because returning `[]` for something the UI
 * expects to be an object crashes it further down.
 */
function lookup(data: Record<string, unknown>, path: string): unknown {
  if (path in data) return data[path]
  const bare = stripQuery(path)
  if (bare in data) return data[bare]
  return undefined
}

/** Lists that a page may ask for but which were empty (or absent) at capture
 * time. Declared so a miss returns the right *kind* of empty value. */
const EMPTY_ARRAY_PREFIXES = [
  '/notifications',
  '/audit-logs',
  '/auth/sessions',
  '/contacts',
  '/conversations',
  '/agents',
  '/users',
  '/workflows',
  '/inboxes',
  '/knowledge-base',
  '/requests',
  '/search',
]

function emptyFor(path: string): unknown {
  const bare = stripQuery(path)
  if (EMPTY_ARRAY_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`))) {
    // Sub-resources of a collection are themselves usually collections
    // (`/conversations/{id}/messages`), but a single item by id is an object.
    const segments = bare.split('/').filter(Boolean)
    const looksLikeSingleItem = segments.length === 2 && segments[1].includes('-')
    return looksLikeSingleItem ? {} : []
  }
  return {}
}

function findById(list: unknown, id: string): Json | undefined {
  if (!Array.isArray(list)) return undefined
  return list.find((x) => (x as Json)?.id === id) as Json | undefined
}

/** The canned reply for the agent config page's Test Environment. Worth
 * answering properly rather than 404-ing: that panel is one of the more
 * interesting things to click on, and a dead box reads as a broken feature
 * rather than an absent backend. */
function agentTestReply(body: Json): Json {
  const message = String((body.message as string) ?? '').trim()
  return {
    reply:
      `This is a demo response. The live version sends your draft configuration ` +
      `to Gemini together with the retrieved knowledge-base context and returns a ` +
      `grounded answer.\n\nYou asked: “${message || '(empty message)'}”`,
    confidence: 'high',
    context_sufficient: true,
    model: (body.config as Json | undefined)?.model ?? 'gemini-3.6-flash',
    sources: [],
  }
}

/**
 * Answer one API call from the in-memory store.
 *
 * `path` is everything after `/api/v1`, matching what `request()` builds.
 */
export async function handleDemoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  await latency()
  const data = await getStore()
  const method = (init?.method ?? 'GET').toUpperCase()
  const bare = stripQuery(path)

  let body: Json = {}
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body) as Json
    } catch {
      body = {}
    }
  }

  if (method === 'GET') {
    const hit = lookup(data, path)
    return (hit === undefined ? emptyFor(path) : hit) as T
  }

  // ---- writes -------------------------------------------------------------

  // Signing in: any known workspace email works, mirroring the real
  // passwordless endpoint. An unknown one still 401s, so the error path in the
  // sign-in form remains demonstrable.
  if (method === 'POST' && bare === '/auth/sessions') {
    const users = (data['/users'] as Json[]) ?? []
    const email = String(body.email ?? '').toLowerCase()
    const user = users.find((u) => String(u.email).toLowerCase() === email)
    if (!user) throw new ApiError('No active workspace account with that email', 401)
    const me = data['/auth/me'] as Json | undefined
    return {
      token: `demo-${uuid()}`,
      user,
      permissions: (me?.permissions as unknown[]) ?? [],
    } as T
  }

  if (method === 'POST' && bare === '/agents/test') {
    return agentTestReply(body) as T
  }

  // Create: append to the collection it was posted to, when that collection
  // exists as a fixture. The echoed row is what the UI puts straight into its
  // list, so it has to carry an id and timestamps like a real one would.
  if (method === 'POST' && Array.isArray(data[bare])) {
    const created: Json = {
      id: uuid(),
      created_at: nowIso(),
      updated_at: nowIso(),
      status: 'active',
      ...body,
    }
    ;(data[bare] as Json[]).unshift(created)
    return created as T
  }

  // Update: merge into the item if we can find it, so an edit made on a detail
  // page is still there when the user navigates back to the list.
  if (method === 'PATCH' || method === 'PUT') {
    const segments = bare.split('/').filter(Boolean)
    const id = segments[segments.length - 1]
    const collection = `/${segments.slice(0, -1).join('/')}`
    const item = findById(data[collection], id)
    if (item) {
      Object.assign(item, body, { updated_at: nowIso() })
      // Keep the single-item endpoint in step with the collection.
      if (data[bare]) Object.assign(data[bare] as Json, item)
      return item as T
    }
    // Settings endpoints are plain objects rather than collections.
    if (data[bare] && typeof data[bare] === 'object') {
      Object.assign(data[bare] as Json, body)
      return data[bare] as T
    }
    return { ...body, updated_at: nowIso() } as T
  }

  if (method === 'DELETE') {
    const segments = bare.split('/').filter(Boolean)
    const id = segments[segments.length - 1]
    const collection = `/${segments.slice(0, -1).join('/')}`
    const list = data[collection]
    if (Array.isArray(list)) {
      const i = list.findIndex((x) => (x as Json)?.id === id)
      if (i !== -1) list.splice(i, 1)
    }
    delete data[bare]
    return undefined as T
  }

  // Anything else (uploads, sync triggers, read-all) — acknowledge it rather
  // than fail. These are fire-and-forget in the UI.
  return {} as T
}
