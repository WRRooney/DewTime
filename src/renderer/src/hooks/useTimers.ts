// staleTime: 100 ms — avoid triple-refetch thrash on rapid start/stop clicks.
// Do NOT set staleTime: 0 — that triggers re-fetches on every focus event
// even with refetchOnWindowFocus: false.
// timersQueryKey typed `as const` so TS treats it as a readonly tuple
// rather than string[], which TanStack Query v5 generics require.

import { useQuery } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'

/** Shared query key for all timers queries and mutation invalidations. */
export const timersQueryKey = ['timers'] as const

export function useTimers() {
  return useQuery<Timer[]>({
    queryKey: timersQueryKey,
    queryFn: () => window.api.timers.list(),
    staleTime: 100, // bump to 200 ms only if rapid-click thrash is observed
  })
}
