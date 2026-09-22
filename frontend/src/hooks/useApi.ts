import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'

type State<T> = {
  data: T | null
  error: string | null
  loading: boolean
}

type Options = {
  /**
   * Poll every N milliseconds. Refreshes are silent: `loading` stays false and
   * existing data is kept, so a live-updating list does not flicker between a
   * spinner and content every few seconds.
   */
  pollMs?: number
}

/**
 * Fetch a GET endpoint, with loading and error state.
 *
 * Deliberately small and dependency-free. When there is a write path that has
 * to invalidate specific views, swap this for TanStack Query; the shape it
 * returns is close enough that components will not need rewriting.
 */
export function useApi<T>(path: string | null, options: Options = {}) {
  const { pollMs } = options
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: path !== null,
  })

  // Tracks whether this path has ever resolved, so the first fetch shows a
  // spinner and subsequent polls do not.
  const hasLoaded = useRef(false)

  const load = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (path === null) {
        setState({ data: null, error: null, loading: false })
        return
      }
      if (!background) {
        setState((current) => ({ ...current, loading: true, error: null }))
      }
      try {
        const data = await api.get<T>(path)
        if (signal?.aborted) return
        hasLoaded.current = true
        setState({ data, error: null, loading: false })
      } catch (error) {
        if (signal?.aborted) return
        const message = error instanceof Error ? error.message : 'Request failed'
        // A failed poll should not wipe a screen that is already showing good
        // data — the next tick will most likely succeed.
        setState((current) =>
          background && current.data !== null
            ? { ...current, loading: false }
            : { data: null, error: message, loading: false },
        )
      }
    },
    [path],
  )

  useEffect(() => {
    hasLoaded.current = false
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!pollMs || path === null) return
    const controller = new AbortController()
    const timer = setInterval(() => {
      // Don't poll a backgrounded tab; it burns requests for nobody.
      if (document.visibilityState === 'hidden') return
      void load(controller.signal, true)
    }, pollMs)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [load, pollMs, path])

  return { ...state, reload: () => load() }
}
