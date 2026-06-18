// Gantt viewport query. Keys ['timeEntries', 'gantt', { from, to }] are distinct
// from ['timeEntries', 'byTimer', id] — mutations must explicitly invalidate both
// the byTimer namespace key AND the gantt key. See Pitfall 1 in 09-RESEARCH.md.

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

/** TanStack Query key factory for the gantt viewport query. */
export const ganttEntriesKey = (fromEpoch: number, toEpoch: number) =>
  ['timeEntries', 'gantt', { from: fromEpoch, to: toEpoch }] as const

/** Fetches all time entries overlapping the epoch range [fromEpoch, toEpoch). */
export function useGanttEntries(fromEpoch: number, toEpoch: number) {
  // The IPC contract (listInRange) requires INTEGER epochs (Zod `.int()`). Zoom/pan
  // produce fractional viewport edges, so floor/ceil here — widening the range
  // outward by <1s is harmless and keeps the query key stable across sub-second drift.
  const from = Math.floor(fromEpoch)
  const to = Math.ceil(toEpoch)
  return useQuery<TimeEntry[]>({
    queryKey: ganttEntriesKey(from, to),
    // Brand at the IPC boundary — callers pass plain numbers, IPC expects EpochSeconds.
    queryFn: () =>
      window.api.timeEntries.listInRange(
        from as EpochSeconds,
        to as EpochSeconds,
      ),
    staleTime: 100,
    // keepPreviousData prevents blank flash during scroll/zoom viewport-key changes.
    placeholderData: keepPreviousData,
    enabled: from < to,
  })
}
