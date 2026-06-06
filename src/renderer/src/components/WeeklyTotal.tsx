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

  // Non-running base — avoids double-counting the running timer.
  const nonRunning = timers.filter((t: Timer) => !t.running)
  const base = nonRunning.reduce((sum: number, t: Timer) => sum + t.totalSeconds, 0)

  const runningTimer = timers.find((t: Timer) => t.running)
  // Use tick.elapsedSeconds if it matches the running timer;
  // fall back to the at-fetch totalSeconds if no matching tick yet.
  const liveContrib =
    tick !== null && runningTimer !== undefined && tick.timerId === runningTimer.id
      ? tick.elapsedSeconds
      : (runningTimer?.totalSeconds ?? 0)

  const total = base + liveContrib

  return <span className={`${styles.totalValue}${extra}`}>{formatDuration(total)}</span>
}
