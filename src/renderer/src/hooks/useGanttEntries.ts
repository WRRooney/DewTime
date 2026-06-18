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
  return useQuery<TimeEntry[]>({
    queryKey: ganttEntriesKey(fromEpoch, toEpoch),
    // Brand at the IPC boundary — callers pass plain numbers, IPC expects EpochSeconds.
    queryFn: () =>
      window.api.timeEntries.listInRange(
        fromEpoch as EpochSeconds,
        toEpoch as EpochSeconds,
      ),
    staleTime: 100,
    // keepPreviousData prevents blank flash during scroll/zoom viewport-key changes.
    placeholderData: keepPreviousData,
    enabled: fromEpoch < toEpoch,
  })
}
