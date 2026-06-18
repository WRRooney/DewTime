// GanttLane: single swim lane — sticky gutter pane + bar track for one timer.
//
// D-05: one lane per timer.
// D-21: double-click empty track space creates a snapped entry (calls onCreateEntryAt).
// D-26: same-lane overlapping entries stack into sub-rows within the lane.
//
// Sub-row assignment is a pure transform over the entries array done at render
// time (no Zustand, no memo dependency on prev assignments) — see 09-RESEARCH.md §OQ3.
//
// Lane height grows to fit the taller of (gutter content, sub-row stack height)
// via CSS align-items: stretch on the parent grid row.
//
// Refs:
//   - 09-06-PLAN.md Task 1
//   - 09-UI-SPEC.md §"Gantt Canvas Layout", §"Overlap Rendering"
//   - 09-PATTERNS.md §"GanttLane analog"
//   - 09-RESEARCH.md §"Open Question 3"

import React from 'react'
import styles from './GanttLane.module.css'
import type { TimeEntry, Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'
import {
  xToEpoch,
  snapEpoch,
  snapIncrementFor,
  type GanttViewport,
} from '@/utils/gantt-math'
import { GanttBar } from './GanttBar'
import { GanttLaneGutter } from './GanttLaneGutter'

// Height per sub-row in pixels (matches standard bar height from UI-SPEC)
const SUBROW_HEIGHT = 24
const SUBROW_PADDING = 4  // top + bottom padding per sub-row set

export interface GanttLaneProps {
  timer: Timer
  entries: TimeEntry[]
  viewport: GanttViewport
  gutterWidthPct: number
  selectedEntryId: number | null
  onSelectEntry: (entryId: number) => void
  onDragTooltip: (t: { startEpoch: EpochSeconds; endEpoch: EpochSeconds } | null) => void
  onCreateEntryAt: (timerId: number, startTs: number, endTs: number) => void
}

interface EntryWithSubRow {
  entry: TimeEntry
  subRow: number
}

/**
 * Compute sub-row assignments for a list of entries for one timer.
 * Each entry is placed on the first sub-row where it doesn't overlap
 * any previously placed entry. Overlaps are epoch-based.
 *
 * D-26: same-lane overlapping entries stack vertically on sub-rows.
 */
function assignSubRows(entries: TimeEntry[]): EntryWithSubRow[] {
  // Sort by start time so greedy placement works correctly
  const sorted = [...entries].sort((a, b) => a.start_timestamp - b.start_timestamp)

  // Track the highest end epoch in each sub-row (epoch or Infinity for running)
  const subRowEnds: number[] = []

  return sorted.map((entry) => {
    const startEpoch = entry.start_timestamp
    // Running entries (end = null) effectively end at "infinity"
    const endEpoch = entry.end_timestamp ?? Infinity

    // Find the first sub-row with no overlap
    let subRow = subRowEnds.findIndex((rowEnd) => rowEnd <= startEpoch)
    if (subRow === -1) {
      subRow = subRowEnds.length
    }

    // Update the end epoch for this sub-row
    subRowEnds[subRow] = endEpoch

    return { entry, subRow }
  })
}

/** Single swim lane: sticky gutter (left) + bar track (right). */
export const GanttLane = React.memo(function GanttLane({
  timer,
  entries,
  viewport,
  gutterWidthPct,
  selectedEntryId,
  onSelectEntry,
  onDragTooltip,
  onCreateEntryAt,
}: GanttLaneProps): JSX.Element {
  const entriesWithSubRows = assignSubRows(entries)
  const maxSubRow = entriesWithSubRows.reduce((max, { subRow }) => Math.max(max, subRow), 0)

  // Track height = max sub-rows × (row height + padding), minimum 44px
  const trackMinHeight = Math.max(44, (maxSubRow + 1) * (SUBROW_HEIGHT + SUBROW_PADDING) + SUBROW_PADDING)

  const handleTrackDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Don't create entry if double-clicking on a bar
    if ((e.target as Element).closest('[data-testid="gantt-bar"]')) return

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const localX = e.clientX - rect.left
    const snap = snapIncrementFor(viewport.spanSeconds)
    const rawEpoch = xToEpoch(localX, viewport)
    const snappedStart = snapEpoch(rawEpoch, snap, e.altKey)
    const snappedEnd = (snappedStart + snap) as EpochSeconds

    onCreateEntryAt(timer.id, snappedStart, snappedEnd)
  }

  const gutterStyle: React.CSSProperties = {
    width: `${gutterWidthPct * 100}%`,
  }

  const trackStyle: React.CSSProperties = {
    width: `${(1 - gutterWidthPct) * 100}%`,
    minHeight: `${trackMinHeight}px`,
    position: 'relative',
  }

  return (
    <div className={styles.lane} data-testid="gantt-lane">
      {/* Sticky gutter pane */}
      <div className={styles.gutterWrapper} style={gutterStyle}>
        <GanttLaneGutter timer={timer} />
      </div>

      {/* Bar track — double-click creates a new entry at the snapped epoch */}
      <div
        className={styles.track}
        style={trackStyle}
        onDoubleClick={handleTrackDoubleClick}
      >
        {entriesWithSubRows.map(({ entry, subRow }) => {
          const topPx = SUBROW_PADDING + subRow * (SUBROW_HEIGHT + SUBROW_PADDING)
          return (
            <div
              key={entry.id}
              className={styles.barRow}
              style={{ top: `${topPx}px`, height: `${SUBROW_HEIGHT}px` }}
            >
              <GanttBar
                entry={entry}
                timer={timer}
                viewport={viewport}
                color={colorForProject(timer.project_id)}
                selected={selectedEntryId === entry.id}
                onSelect={onSelectEntry}
                onDragTooltip={onDragTooltip}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Project color palette (Claude's discretion — UI-SPEC §Color)
// ---------------------------------------------------------------------------

/** Per-project palette: 6 desaturated hues cycled by project_id % 6. */
const PROJECT_COLORS = [
  'hsl(210 35% 55%)', // slot 0: steel blue
  'hsl(155 30% 52%)', // slot 1: muted teal
  'hsl(280 28% 57%)', // slot 2: muted violet
  'hsl(35 40% 55%)',  // slot 3: amber
  'hsl(0 30% 56%)',   // slot 4: rose
  'hsl(50 38% 55%)',  // slot 5: gold
] as const

/** Return the bar color for a given project_id. null → muted border color (no project). */
export function colorForProject(projectId: number | null): string {
  if (projectId === null) return 'hsl(220 10% 40%)'
  return PROJECT_COLORS[((projectId % PROJECT_COLORS.length) + PROJECT_COLORS.length) % PROJECT_COLORS.length]!
}
