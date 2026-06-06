// Pure functions: day and week epoch boundaries from a local Date.
//
// Date.now() is FORBIDDEN here — use new Date(date) copies + setHours(0,0,0,0)
// for local-time midnight. Never Date.UTC(). No date library imports.
//
// weekStart mapping: 0=Monday in this app maps to getDay()===1;
// 6=Sunday maps to getDay()===0. NEVER pass weekStart directly to getDay() comparisons.

import type { EpochSeconds } from '@shared/time'

/**
 * Return the half-open [localMidnight, nextLocalMidnight) epoch range for
 * the calendar day containing `date`. Both boundaries are in local wall-clock
 * time — never UTC.
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
 * The `weekStart` parameter uses the APP encoding (0=Monday, 6=Sunday),
 * which is NOT the same as JS Date.getDay() (0=Sunday, 1=Monday, ...).
 * This function maps explicitly: weekStart===6 → firstDayOfWeek=0 (Sunday),
 * weekStart===0 → firstDayOfWeek=1 (Monday). NEVER pass weekStart directly
 * to getDay() comparisons.
 *
 * @param date      - Any Date within the desired week.
 * @param weekStart - App encoding: 0=Monday, 6=Sunday.
 */
export function weekRangeOf(
  date: Date,
  weekStart: 0 | 6,
): { fromEpoch: EpochSeconds; toEpoch: EpochSeconds } {
  // Explicit mapping — NEVER pass weekStart directly to getDay() comparisons.
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
