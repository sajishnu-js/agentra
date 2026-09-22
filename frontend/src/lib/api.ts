/**
 * The one place that talks to FastAPI.
 *
 * Requests go to a relative /api path, which Vite proxies to :8000 in dev, so
 * there is no base URL to configure and no CORS in the browser.
 */

import { DEMO_MODE } from '@/demo/mode'

export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: tsconfig sets erasableSyntaxOnly, which disallows those.
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const BASE = '/api/v1'

// Module-level rather than passed through every call site: almost every
// request needs it, and threading a token argument through useApi and every
// page that calls `api.*` directly would be pure ceremony. AuthProvider is
// the only thing that ever calls setAuthToken.
let authToken: string | null = null

export function setAuthToken(token: string | null): void {
  authToken = token
}

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

/** AuthProvider subscribes to this once, to clear a dead session the moment
 * any request discovers it — not just the next explicit /auth/me check. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // The public demo build has no backend behind it. Answer from the captured
  // fixtures instead of letting every panel fall into an error state.
  //
  // `DEMO_MODE` folds to a literal at build time, so with it unset this whole
  // branch is eliminated and the main bundle ends up with no reference to the
  // demo chunk at all. (The chunk itself is still emitted into dist/ as an
  // orphan — nothing loads it, so it costs a file on disk and no bytes over
  // the wire.) Dynamic rather than a static import so that stays true and the
  // ~194 KB of fixtures never lands in the entry bundle.
  if (DEMO_MODE) {
    const { handleDemoRequest } = await import('@/demo/server')
    return handleDemoRequest<T>(path, init)
  }

  // A FormData body (file uploads) must NOT get a manual Content-Type — the
  // browser sets one with the multipart boundary fetch itself generates,
  // and overriding it here would send a boundary-less header FastAPI can't
  // parse.
  const isFormData = init?.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!response.ok) {
    // FastAPI puts the reason in `detail`; fall back to the status text.
    let detail = response.statusText
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // Response had no JSON body — the status text is all we have.
    }
    if (response.status === 401) {
      unauthorizedListeners.forEach((listener) => listener())
    }
    throw new ApiError(detail, response.status)
  }

  // A 204 (e.g. DELETE /agents/{id}) has no body — response.json() would
  // throw on the empty string. `T` is `void` at every such call site.
  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
