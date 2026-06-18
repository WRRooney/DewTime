// GanttDragTooltip: floating tooltip shown during gantt bar drag.
//
// Purely presentational: receives startEpoch/endEpoch/position from GanttBar
// via parent state and renders Start/End/Duration in monospace.
//
// D-20: live drag tooltip — shows HH:MM for start and end, H:MM for duration.
// UI-SPEC §Drag Handles: 8px above bar, monospace --font-size-xs, bg --color-bg-elevated,
//   border --color-border, padding 4px 8px, --radius-sm.

import styles from './GanttDragTooltip.module.css'
import type { EpochSeconds } from '@shared/time'

export interface GanttDragTooltipProps {
  startEpoch: EpochSeconds
  endEpoch: EpochSeconds
  /** Pixel x position (from bar's left edge center) */
  x: number
  /** Pixel y position (top of bar — tooltip renders 8px above this) */
  y: number
}

/**
 * Format an EpochSeconds as local HH:MM for the drag tooltip.
 */
function formatHHMM(epochSeconds: EpochSeconds): string {
  const d = new Date(epochSeconds * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Format duration in seconds as H:MM (e.g. 90 min → "1:30", 5 min → "0:05").
 */
function formatDurationHMM(seconds: number): string {
  const absSeconds = Math.abs(seconds)
  const h = Math.floor(absSeconds / 3600)
  const m = Math.floor((absSeconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

/** Floating drag tooltip showing Start / End / Duration during bar drag (D-20). */
export function GanttDragTooltip({ startEpoch, endEpoch, x, y }: GanttDragTooltipProps): JSX.Element {
  const durationSeconds = endEpoch - startEpoch

  return (
    <div
      className={styles.tooltip}
      style={{
        left: x,
        // Render 8px above the given y position (top of bar)
        top: y - 8,
        transform: 'translateX(-50%) translateY(-100%)',
      }}
    >
      <span>Start: {formatHHMM(startEpoch)}</span>
      <span>End: {formatHHMM(endEpoch)}</span>
      <span>Duration: {formatDurationHMM(durationSeconds)}</span>
    </div>
  )
}
