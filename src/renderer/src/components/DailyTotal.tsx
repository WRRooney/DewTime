// Live daily total readout — subscribes to useDayTimers + useTickStore.
//
// Renders the total elapsed seconds for all timers on the selected day as
// HH:MM:SS:
//
//   base        = sum of EVERY timer's totalSeconds
//   liveContrib = tick.elapsedSeconds when tick.timerId === runningTimer.id, else 0
//   total       = base + liveContrib
//
// Why base sums ALL timers (including the running one): `Timer.totalSeconds`
// comes from the SQL `SUM(CASE WHEN end_timestamp IS NOT NULL ...)`, which
// EXCLUDES the open (running) entry — that entry contributes 0. So totalSeconds
// is purely the timer's COMPLETED time in range. The running entry's live
// elapsed is disjoint from that and is added once via the tick. Excluding the
// running timer from base (the previous behavior) silently dropped its earlier
// completed entries from the total whenever it was running.
//
// Imports CSS from DateNavToolbar.module.css (shared namespace — no separate file).

import styles from './DateNavToolbar.module.css'
import { useDayTimers } from '@/hooks/useDateTimers'
import { useTickStore } from '@/stores/useTickStore'
import { formatDuration } from '@/utils/format-duration'
import type { Timer } from '@shared/ipc'

interface DailyTotalProps {
  fromEpoch: number
  toEpoch: number
  /** Extra class appended to the value span (e.g. the header day-total readout). */
  className?: string | undefined
}

/**
 * Renders the live daily total HH:MM:SS for timers in [fromEpoch, toEpoch).
 * Subscribes to useTickStore for per-second updates.
 */
export function DailyTotal({ fromEpoch, toEpoch, className }: DailyTotalProps): JSX.Element {
  const { data: timers = [], isLoading, isError } = useDayTimers(fromEpoch, toEpoch)
  const tick = useTickStore((s) => s.tick)

  const extra = className ? ` ${className}` : ''

  // Loading or failed query → sentinel, NOT 00:00:00: a silent zero is
  // indistinguishable from a genuinely empty day (e.g. an out-of-range date).
  if (isLoading || isError) {
    return (
      <span className={`${styles.totalValue} ${styles.totalLoading}${extra}`}>—:—:—</span>
    )
  }

  // Base = every timer's COMPLETED seconds (totalSeconds excludes the open
  // running entry — see header). The running entry's live time is added on top.
  const base = timers.reduce((sum: number, t: Timer) => sum + t.totalSeconds, 0)

  const runningTimer = timers.find((t: Timer) => t.running)
  // Add the running entry's live elapsed (disjoint from base). Until the first
  // matching tick arrives (≤1s), it contributes 0 — never the stale fallback,
  // which would now double-count against base.
  const liveContrib =
    tick !== null && runningTimer !== undefined && tick.timerId === runningTimer.id
      ? tick.elapsedSeconds
      : 0

  const total = base + liveContrib

  return <span className={`${styles.totalValue}${extra}`}>{formatDuration(total)}</span>
}
