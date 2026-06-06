import { useQuery } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'

/** Namespace prefix for entries-by-timer queries — invalidate this to refresh all dialog entry lists. */
export const entriesNamespaceKey = ['timeEntries', 'byTimer'] as const
/** Full query key for a specific timer's entries. */
export const entriesForTimerKey = (id: number | null) =>
  ['timeEntries', 'byTimer', id] as const

/**
 * Fetches the time entries for a timer via `window.api.timeEntries.listByTimer(timerId)`.
 * Only runs while `timerId` is non-null (i.e., the TimestampEditorDialog is open).
 * staleTime: 0 — always refetches so edits in the dialog reflect immediately.
 */
export function useEntriesForTimer(timerId: number | null) {
  return useQuery<TimeEntry[]>({
    queryKey: entriesForTimerKey(timerId),
    // Guard rather than assert: TanStack can re-run the last queryFn during the
    // enabled→disabled transition, so listByTimer(null) must be handled safely.
    queryFn: () => (timerId === null ? Promise.resolve([]) : window.api.timeEntries.listByTimer(timerId)),
    enabled: timerId !== null,
    staleTime: 0, // always fresh — edits happen in the popup
  })
}
