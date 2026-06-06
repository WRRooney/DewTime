// Date-scoped timer queries. Keys ['timers', { from, to }] are sub-keys under
// the ['timers'] prefix, so existing mutations that invalidate ['timers'] also
// invalidate these automatically via TanStack v5 prefix-matching.

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

/** Fetches timers in the half-open epoch range [fromEpoch, toEpoch). Drives the timer table and DailyTotal. */
export function useDayTimers(fromEpoch: number, toEpoch: number) {
  return useQuery<Timer[]>({
    queryKey: ['timers', { from: fromEpoch, to: toEpoch }],
    // Brand at the IPC boundary — callers pass plain numbers, IPC expects EpochSeconds.
    queryFn: () =>
      window.api.timers.list({
        fromEpoch: fromEpoch as EpochSeconds,
        toEpoch: toEpoch as EpochSeconds,
      }),
    staleTime: 100,
    // keepPreviousData prevents data from flipping to undefined during date navigation.
    placeholderData: keepPreviousData,
  })
}

/** Fetches timers in the half-open epoch range [fromEpoch, toEpoch) for the selected week. Drives WeeklyTotal. */
export function useWeekTimers(fromEpoch: number, toEpoch: number) {
  return useQuery<Timer[]>({
    queryKey: ['timers', { from: fromEpoch, to: toEpoch }],
    // Brand at the IPC boundary — callers pass plain numbers, IPC expects EpochSeconds.
    queryFn: () =>
      window.api.timers.list({
        fromEpoch: fromEpoch as EpochSeconds,
        toEpoch: toEpoch as EpochSeconds,
      }),
    staleTime: 100,
    placeholderData: keepPreviousData, // hold prior data across date-key changes
  })
}
