import styles from './DateNavToolbar.module.css'
import { useWeekTimers } from '@/hooks/useDateTimers'
import { useTickStore } from '@/stores/useTickStore'
import { formatDuration } from '@/utils/format-duration'
import type { Timer } from '@shared/ipc'

interface WeeklyTotalProps {
  fromEpoch: number
  toEpoch: number
  /** Extra class appended to the value span (e.g. the header week-total chip). */
  className?: string | undefined
}

/**
 * Renders the live weekly total HH:MM:SS for timers in [fromEpoch, toEpoch).
 * Subscribes to useTickStore for per-second updates.
 */
export function WeeklyTotal({ fromEpoch, toEpoch, className }: WeeklyTotalProps): JSX.Element {
  const { data: timers = [], isLoading, isError } = useWeekTimers(fromEpoch, toEpoch)
  const tick = useTickStore((s) => s.tick)

  const extra = className ? ` ${className}` : ''

  // Loading or failed query → sentinel, NOT 00:00:00: a silent zero is
  // indistinguishable from a genuinely empty week (e.g. an out-of-range date).
  if (isLoading || isError) {
    return (
      <span className={`${styles.totalValue} ${styles.totalLoading}${extra}`}>—:—:—</span>
    )
  }

  // Base = every timer's COMPLETED seconds. Timer.totalSeconds comes from the
  // SQL SUM(CASE WHEN end_timestamp IS NOT NULL ...), which EXCLUDES the open
  // running entry (contributes 0), so it is purely completed time. The running
  // entry's live elapsed is disjoint and added once via the tick. Excluding the
  // running timer from base dropped its earlier completed entries while running.
  const base = timers.reduce((sum: number, t: Timer) => sum + t.totalSeconds, 0)

  const runningTimer = timers.find((t: Timer) => t.running)
  // Add the running entry's live elapsed (disjoint from base). 0 until the first
  // matching tick (≤1s); never the stale fallback, which would double-count.
  const liveContrib =
    tick !== null && runningTimer !== undefined && tick.timerId === runningTimer.id
      ? tick.elapsedSeconds
      : 0

  const total = base + liveContrib

  return <span className={`${styles.totalValue}${extra}`}>{formatDuration(total)}</span>
}
