// Derives isRunning from Timer.running — does NOT subscribe to the tick store.
// Only DurationCell may import the tick store; per-second ticks never touch this cell.
// No optimistic update: local SQLite round-trip is < 5 ms so it adds complexity
// without perceived benefit.

import React from 'react'
import styles from './StartStopCell.module.css'
import type { Timer } from '@shared/ipc'
import { useStartTimer } from '@/hooks/useStartTimer'
import { useStopTimer } from '@/hooks/useStopTimer'

interface StartStopCellProps {
  timer: Timer
}

/** ▶/■ icon button that starts or stops a timer. Derives isRunning from Timer.running. */
export const StartStopCell = React.memo(function StartStopCell({ timer }: StartStopCellProps): JSX.Element {
  const isRunning = timer.running
  const start = useStartTimer()
  const stop = useStopTimer()

  const handleClick = (): void => {
    if (isRunning) {
      stop.mutate(timer.id)
    } else {
      start.mutate(timer.id)
    }
  }

  return (
    <button
      type="button"
      className={`${styles.btn} ${isRunning ? styles.running : styles.notRunning}`}
      aria-label={isRunning ? (
        'Stop timer'
      ) : (
        'Start timer'
      )}
      data-testid="start-stop-btn"
      onClick={handleClick}
    >
      {isRunning ? 'Stop' : 'Start'}
    </button>
  )
})
