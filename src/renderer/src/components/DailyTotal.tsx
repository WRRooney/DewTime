// src/renderer/src/components/DailyTotal.tsx
// Live daily total readout — subscribes to useDayTimers + useTickStore.
//
// Renders the total elapsed seconds for all timers on the selected day as
// HH:MM:SS using the non-running-base formula from RESEARCH Pattern 5 / E5:
//
//   base       = sum of non-running timers' totalSeconds
//   liveContrib = tick.elapsedSeconds when tick.timerId === runningTimer.id
//                 runningTimer.totalSeconds (at-fetch fallback) when no matching tick
//   total       = base + liveContrib
//
// This formula avoids the double-count pitfall (RESEARCH Pitfall 3 / T-6-08):
// adding both running.totalSeconds AND tick.elapsedSeconds would count the
// running timer's pre-fetch elapsed time twice.
//
// Per-second re-renders are expected and explicitly permitted (A-13 note):
// DailyTotal and WeeklyTotal are NOT table cell components, so A-13 does not
// restrict them from subscribing to useTickStore (DATE-08).
//
// Imports CSS from DateNavToolbar.module.css (shared namespace — no separate file).
//
// Refs:
//   - 06-04-PLAN.md Task 2
//   - 06-PATTERNS.md § DailyTotal.tsx
//   - 06-RESEARCH.md § Pattern 5, § E5, Pitfall 3
//   - 06-UI-SPEC.md § Daily and weekly total readouts

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
 * Subscribes to useTickStore for per-second updates (DATE-08).
 */
export function DailyTotal({ fromEpoch, toEpoch, className }: DailyTotalProps): JSX.Element {
  const { data: timers = [], isLoading, isError } = useDayTimers(fromEpoch, toEpoch)
  const tick = useTickStore((s) => s.tick)

  const extra = className ? ` ${className}` : ''

  // Loading or failed query → sentinel, NOT 00:00:00 (WR-01): a silent zero is
  // indistinguishable from a genuinely empty day (e.g. an out-of-range date).
  if (isLoading || isError) {
    return (
      <span className={`${styles.totalValue} ${styles.totalLoading}${extra}`}>—:—:—</span>
    )
  }

  // Non-running base — avoids double-counting the running timer (RESEARCH Pitfall 3)
  const nonRunning = timers.filter((t: Timer) => !t.running)
  const base = nonRunning.reduce((sum: number, t: Timer) => sum + t.totalSeconds, 0)

  const runningTimer = timers.find((t: Timer) => t.running)
  // liveContrib: use tick.elapsedSeconds if tick is for the running timer;
  // fall back to the at-fetch totalSeconds if no matching tick yet.
  const liveContrib =
    tick !== null && runningTimer !== undefined && tick.timerId === runningTimer.id
      ? tick.elapsedSeconds
      : (runningTimer?.totalSeconds ?? 0)

  const total = base + liveContrib

  return <span className={`${styles.totalValue}${extra}`}>{formatDuration(total)}</span>
}
