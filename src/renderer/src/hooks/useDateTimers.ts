// src/renderer/src/hooks/useDateTimers.ts
// TanStack Query v5 hooks for date-scoped timer queries (D-08).
//
// useDayTimers(fromEpoch, toEpoch) — drives the timer table + DailyTotal for
//   the selected day. Key: ['timers', { from, to }] — prefix-invalidated by
//   all existing mutations that invalidate ['timers'] (TanStack v5 behavior).
//
// useWeekTimers(fromEpoch, toEpoch) — drives WeeklyTotal for the selected week.
//   Distinct key from the day query; same invalidation coverage.
//
// `staleTime: 100` — same as useTimers (D-12 rationale: avoid refetch thrash).
//
// NOTE: `timersQueryKey = ['timers'] as const` is NOT exported from this file —
//   it lives solely in useTimers.ts, which all mutation hooks already import.
//   Date-scoped keys ['timers', { from, to }] are sub-keys under that prefix;
//   TanStack v5 prefix-invalidates them automatically when mutations call
//   invalidateQueries({ queryKey: ['timers'] }) — no mutation changes needed.
//
// Refs:
//   - 06-CONTEXT.md D-08 (two date-scoped queries, ['timers'] namespace)
//   - 06-RESEARCH.md § Pattern 3

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

/**
 * Fetches timers whose created_at falls in the half-open epoch range
 * [fromEpoch, toEpoch). Drives the timer table and DailyTotal for the
 * selected day. Key: ['timers', { from: fromEpoch, to: toEpoch }] —
 * prefix-invalidated by all existing mutation hooks that invalidate ['timers'].
 */
export function useDayTimers(fromEpoch: number, toEpoch: number) {
  return useQuery<Timer[]>({
    queryKey: ['timers', { from: fromEpoch, to: toEpoch }],
    // Brand at the IPC boundary (sanctioned `as EpochSeconds` read-boundary cast,
    // see @shared/time) — callers pass plain epoch-second numbers.
    queryFn: () =>
      window.api.timers.list({
        fromEpoch: fromEpoch as EpochSeconds,
        toEpoch: toEpoch as EpochSeconds,
      }),
    staleTime: 100, // D-12 — same rationale as useTimers
    // On a date change the key changes; keepPreviousData holds the prior result
    // (instead of undefined) until the new fetch resolves, so `data` never flips
    // to undefined/[] mid-flight (avoids re-render churn during navigation).
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetches timers whose created_at falls in the half-open epoch range
 * [fromEpoch, toEpoch) for the selected week. Drives WeeklyTotal.
 * Key: ['timers', { from: fromEpoch, to: toEpoch }] — prefix-invalidated
 * identically to useDayTimers by existing mutation hooks.
 */
export function useWeekTimers(fromEpoch: number, toEpoch: number) {
  return useQuery<Timer[]>({
    queryKey: ['timers', { from: fromEpoch, to: toEpoch }],
    // Brand at the IPC boundary (sanctioned `as EpochSeconds` read-boundary cast,
    // see @shared/time) — callers pass plain epoch-second numbers.
    queryFn: () =>
      window.api.timers.list({
        fromEpoch: fromEpoch as EpochSeconds,
        toEpoch: toEpoch as EpochSeconds,
      }),
    staleTime: 100, // D-12 — same rationale as useTimers
    placeholderData: keepPreviousData, // hold prior data across date-key changes (see useDayTimers)
  })
}
