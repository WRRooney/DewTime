// src/renderer/src/hooks/useEntriesForTimer.ts
// TanStack Query v5 hook for a timer's time entries (D-15).
//
// Query key follows 05-RESEARCH § Open Questions #3: ['timeEntries', 'byTimer', timerId]
// enabled: timerId !== null — only fetches while the TimestampEditorDialog is open (D-15).
// staleTime: 0 — always fresh because edits happen in the popup.
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state; enabled guard)
//   - src/renderer/src/hooks/useTimers.ts (query pattern source)

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
    // enabled→disabled transition; listByTimer(null) would trip the IPC Zod gate.
    queryFn: () => (timerId === null ? Promise.resolve([]) : window.api.timeEntries.listByTimer(timerId)),
    enabled: timerId !== null,
    staleTime: 0, // always fresh — edits happen in the popup
  })
}
