// This is the SOLE useTickStore subscriber among all cell components.
// React.memo is required: without it the per-second tick store update propagates to
// the row + table parents, undoing the push-tick "one DOM node per second" optimization.
//
// timer.totalSeconds = completed entries only (running entry excluded by the SQL query).
// Adding tick.elapsedSeconds here gives the live total without double-counting.
//
// Zustand's Object.is equality check re-renders this cell whenever setTick(newObj) is
// called (every 1 s while running). No useShallow needed for a single-property
// object-reference selector.

import React from 'react'
import styles from './DurationCell.module.css'
import type { Timer } from '@shared/ipc'
import { useTickStore } from '@/stores/useTickStore'
import { formatDuration } from '@/utils/format-duration'
import { formatDecimalHours } from '@/utils/format-hours'
import { CopyButton } from '@/components/CopyButton'

interface DurationCellProps {
  timer: Timer
}

/** Live-ticking duration cell. React.memo + lone useTickStore subscriber. */
export const DurationCell = React.memo(function DurationCell({ timer }: DurationCellProps): JSX.Element {
  const tick = useTickStore((s) => s.tick)

  // Gate on timer.running (not just tick.timerId) to avoid a one-frame double-count
  // when switching timers: the React Query refetch and the tick push arrive on
  // independent channels, so a stale tick can still reference the just-stopped timer
  // while totalSeconds already includes that segment. timer.running comes from the
  // same query snapshot as totalSeconds, so it keeps them consistent.
  const seconds =
    timer.running && tick !== null && tick.timerId === timer.id
      ? timer.totalSeconds + tick.elapsedSeconds
      : timer.totalSeconds

  const handleClick = (): void => {
    void window.api.editor.open(timer.id)
  }

  // The copy button copies billing-rounded decimal hours (quarter-hour, rounds up at 5 min past)
  // — e.g. "1.25" — not the HH:MM:SS display value.
  return (
    <span className={styles.cellWrap}>
      <span
        className={`${styles.duration}${timer.running ? ` ${styles.running}` : ''}`}
        onClick={handleClick}
        aria-label="Edit timestamps for this timer"
      >
        {formatDuration(seconds)}
      </span>
      <CopyButton value={formatDecimalHours(seconds)} label="Copy hours (decimal)" />
    </span>
  )
})
