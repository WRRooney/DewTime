// src/renderer/src/components/timer-table/cells/StartStopCell.tsx
// ▶/■ icon button for starting/stopping a timer (D-26).
//
// Running detection: Option B — derives `isRunning` from `Timer.running` (the
// boolean added to the Timer interface in plan 04-02). This AVOIDS subscribing to
// the tick store, keeping the A-13 invariant absolute: only DurationCell (plan 04-08)
// may import the tick store. Per-second tick events never touch this cell.
//
// Click: mutate-then-invalidate (no optimistic update per D-26). Local SQLite
// round-trip is < 5 ms so optimistic UI adds complexity without perceived benefit.
//
// SVG glyphs from UI-SPEC § Inline SVG:
//   ▶ = filled triangle path `d="M4 3v10l8-5z"` with fill="currentColor"
//   ■ = filled rect `<rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor"/>`
//
// React.memo: cell re-renders only when timer.id or timer.running changes (D-03).
//
// Refs:
//   - 04-CONTEXT.md D-26 (start/stop; no optimistic update)
//   - 04-UI-SPEC.md § StartStopCell Option B (running derived from Timer.running)
//   - 04-PATTERNS.md § StartStopCell (icon-button analog: TitleBar.tsx)
//   - Anti-pattern A-13: this cell does NOT import the tick store (DurationCell only)
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

import React from 'react'
import styles from './StartStopCell.module.css'
import type { Timer } from '@shared/ipc'
import { useStartTimer } from '@/hooks/useStartTimer'
import { useStopTimer } from '@/hooks/useStopTimer'

interface StartStopCellProps {
  timer: Timer
}

/** ▶/■ icon button that starts or stops a timer. Derives isRunning from Timer.running (Option B, A-13). */
export const StartStopCell = React.memo(function StartStopCell({ timer }: StartStopCellProps): JSX.Element {
  // Option B: derive running state from Timer row — does NOT subscribe to tick store (A-13)
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

  // Ignition-parity: text pill (psc-Timer/ButtonStopped → "Start", ButtonRunning → "Stop").
  // monospace + uppercase + letter-spacing comes from the CSS module; the glyph is gone.
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
