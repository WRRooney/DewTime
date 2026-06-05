// src/renderer/src/utils/date-ranges.ts
// Pure functions: day and week epoch boundaries from a local Date.
//
// A-18 equivalent: Date.now() is FORBIDDEN. Use new Date(date) copies +
//   setHours(0,0,0,0) for local-time midnight. Never Date.UTC().
// A-23: weekStart mapping — 0=Monday in this app is getDay()===1;
//   6=Sunday is getDay()===0. NEVER pass weekStart directly to getDay() comparisons.
// A-20: no date-fns/dayjs/luxon import (D-04).
//
// Refs:
//   - 06-CONTEXT.md D-06 (local-time half-open range)
//   - 06-CONTEXT.md D-10 (week-start encoding pitfall)
//   - 06-RESEARCH.md § Pattern 2, Pitfall 1, Pitfall 2

import type { EpochSeconds } from '@shared/time'

/**
 * Return the half-open [localMidnight, nextLocalMidnight) epoch range for
 * the calendar day containing `date`. Both boundaries are in local wall-clock
 * time — never UTC (Pitfall 2 / A-18 equivalent).
 *
 * A timer is IN this range iff: fromEpoch <= created_at < toEpoch.
 */
export function dayRangeOf(date: Date): { fromEpoch: EpochSeconds; toEpoch: EpochSeconds } {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0) // local midnight of this day
  const end = new Date(start)
  end.setDate(end.getDate() + 1) // next local midnight (half-open)
  return {
    fromEpoch: Math.floor(start.getTime() / 1000) as EpochSeconds,
    toEpoch: Math.floor(end.getTime() / 1000) as EpochSeconds,
  }
}

/**
 * Return the half-open [weekStart, weekStart+7days) epoch range for the
 * calendar week containing `date`, anchored by the `weekStart` setting.
 *
 * A-23: The `weekStart` parameter uses the APP encoding (0=Monday, 6=Sunday),
 *   which is NOT the same as JS Date.getDay() (0=Sunday, 1=Monday, ...).
 *   This function maps explicitly: weekStart===6 → firstDayOfWeek=0 (Sunday),
 *   weekStart===0 → firstDayOfWeek=1 (Monday). NEVER pass weekStart directly
 *   to getDay() comparisons.
 *
 * @param date      - Any Date within the desired week.
 * @param weekStart - App encoding: 0=Monday, 6=Sunday (from SettingsContext.WeekStart).
 */
export function weekRangeOf(
  date: Date,
  weekStart: 0 | 6,
): { fromEpoch: EpochSeconds; toEpoch: EpochSeconds } {
  // A-23: explicit mapping — NEVER pass weekStart directly to getDay() comparisons.
  //   weekStart===0 (Monday) → JS getDay()===1
  //   weekStart===6 (Sunday) → JS getDay()===0
  const firstDayOfWeek = weekStart === 6 ? 0 : 1

  const day = date.getDay()
  const offsetBack = (day - firstDayOfWeek + 7) % 7
  const start = new Date(date)
  start.setDate(start.getDate() - offsetBack)
  start.setHours(0, 0, 0, 0) // local midnight of the first day of the week
  const end = new Date(start)
  end.setDate(end.getDate() + 7) // next week's start (half-open)
  return {
    fromEpoch: Math.floor(start.getTime() / 1000) as EpochSeconds,
    toEpoch: Math.floor(end.getTime() / 1000) as EpochSeconds,
  }
}
