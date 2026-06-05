// src/renderer/src/hooks/useTimers.ts
// TanStack Query v5 hook for the timers list (D-12).
//
// Wraps window.api.timers.list() in a useQuery with a shared queryKey so all
// mutation hooks can invalidate the same cache entry on success.
//
// `staleTime: 100` (ms) — per D-12 research flag: bump to 200 ms if rapid
// start/stop clicks cause triple-refetch thrash (the manual UAT in plan 04-08
// will surface this). Do NOT set staleTime: 0 — that causes re-fetches on
// every focus event even with refetchOnWindowFocus: false.
//
// `timersQueryKey` is exported as a `const` so every mutation can import it
// without string-typing the key in multiple files. Typed `as const` so TS
// treats it as readonly tuple rather than string[] — required for TanStack
// Query v5's query key generics.
//
// Refs:
//   - 04-CONTEXT.md D-12 (TanStack Query v5 hooks + staleTime rationale)
//   - 04-RESEARCH.md § Pattern 2 (canonical hooks + QueryClient setup)

import { useQuery } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'

/** Shared query key for all timers queries and mutation invalidations. */
export const timersQueryKey = ['timers'] as const

/**
 * Fetches the full timers list via `window.api.timers.list()`.
 * All 5 mutation hooks invalidate this same key on success so the table
 * re-fetches automatically after every CRUD operation.
 */
export function useTimers() {
  return useQuery<Timer[]>({
    queryKey: timersQueryKey,
    queryFn: () => window.api.timers.list(),
    staleTime: 100, // D-12 — bump to 200 ms only if rapid-click thrash observed
  })
}
