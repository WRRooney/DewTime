// src/renderer/src/components/timer-table/cells/DurationCell.tsx
// Live-ticking duration display for a timer row (D-09 / D-10).
//
// This is the SOLE useTickStore subscriber among all cell components (A-13).
// React.memo wrapping is MANDATORY (UI-SPEC § DurationCell + CONTEXT § specifics):
// without it the per-second tick store update propagates to the row + table parents
// and undoes the push-tick architecture's "one DOM node per second" optimization.
//
// Display logic (D-10):
//   running row:  formatDuration(timer.totalSeconds + tick.elapsedSeconds)
//   static row:   formatDuration(timer.totalSeconds)
//
// IMPORTANT — timer.totalSeconds is the sum of COMPLETED entries only (running
// entry excluded). This is intentional: the SQL query in timers.ts was fixed to
// exclude the running entry from totalSeconds so that adding tick.elapsedSeconds
// here does NOT double-count. The previous query used COALESCE(end_timestamp, nowSeconds())
// which baked the running entry's elapsed time into the stale totalSeconds, then
// this cell added tick.elapsedSeconds again — causing drift of up to several minutes.
//
// The primitive selector `useTickStore(s => s.tick)` returns the whole tick
// object reference. Zustand's Object.is equality check re-renders this cell
// whenever setTick(newObj) is called (i.e. every 1 s while a timer is running),
// which is exactly the desired cadence. No useShallow needed for a single-property
// object-reference selector (RESEARCH § Pattern 3 critical note).
//
// A-13 grep gate: ONLY this file among cells/*.tsx imports useTickStore.
//
// D-06 (UAT follow-up): onClick -> window.api.editor.open(timer.id), which opens
//   the timestamp editor in a SEPARATE OS window. No store subscription is added,
//   so React.memo stays effective and A-13 is NOT violated.
//
// Refs:
//   - 04-CONTEXT.md D-09 (tick store shape + sole-subscriber contract)
//   - 04-CONTEXT.md D-10 (static fallback + live total formula)
//   - 04-UI-SPEC.md § DurationCell (font / align / tabular-nums / React.memo)
//   - 04-RESEARCH.md § Pattern 3 lines 551-567 (canonical DurationCell template)
//   - 05-CONTEXT.md D-06 (DurationCell click → timestamp editor popup)
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

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

/** Live-ticking duration cell. React.memo + lone useTickStore subscriber (A-13). */
export const DurationCell = React.memo(function DurationCell({ timer }: DurationCellProps): JSX.Element {
  // Primitive object-reference selector — Zustand re-renders only when setTick(newObj)
  // is called (i.e. once per second while a timer is running). A-13: this is the ONLY
  // cell component that subscribes to useTickStore.
  const tick = useTickStore((s) => s.tick)

  // timer.totalSeconds = completed entries only (running entry intentionally excluded).
  // tick.elapsedSeconds = live elapsed for the current running entry segment.
  // Adding them gives the correct total without double-counting the running segment.
  //
  // FLASH FIX (switch double-count): gate on timer.running, NOT just tick.timerId.
  // When switching A→B, the React Query refetch (timer.running, totalSeconds) and the
  // tick push (tick.timerId, elapsedSeconds) arrive on independent channels with no
  // ordering guarantee. If the refetch lands first, A.totalSeconds already includes the
  // just-stopped segment while the stale tick still has timerId===A with its old
  // elapsedSeconds — adding them double-counts the segment for one frame ("flashes ahead
  // a few seconds"). timer.running comes from the SAME query snapshot as totalSeconds, so
  // gating on it keeps the two consistent: a row the query reports as stopped never adds a
  // live tick, even a stale one. Augmentation applies only when the row is authoritatively
  // running AND the live tick is for this same timer.
  const seconds =
    timer.running && tick !== null && tick.timerId === timer.id
      ? timer.totalSeconds + tick.elapsedSeconds
      : timer.totalSeconds

  // D-06 (UAT follow-up): open the timestamp editor in a SEPARATE OS window via
  // IPC (window.api.editor.open) instead of an in-window modal. No store
  // subscription added → React.memo stays effective and A-13 is not violated.
  const handleClick = (): void => {
    void window.api.editor.open(timer.id)
  }

  // Ignition-parity: a running timer's duration reads bold + accent (var(--indicator)
  // in v0); a stopped timer reads normal weight. The running flag comes from the
  // same query snapshot as totalSeconds (see flash-fix note above).
  //
  // The copy button copies the billing-rounded DECIMAL HOURS (quarter-hour,
  // "5 minutes past rounds up") — e.g. "1.25" — not the HH:MM:SS display value.
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
