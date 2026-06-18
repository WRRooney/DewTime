// GanttAxisHeader: sticky two-tier time axis header.
//
// D-11: sticky top header stays pinned during vertical scroll.
// D-12: adaptive tick granularity based on viewport.spanSeconds:
//         span > 3 days (259200s) → 4-hour ticks
//         span 1–3 days (86400–259200s) → 1-hour ticks
//         span < 1 day (< 86400s) → 15-minute ticks
//
// Top tier: date + day-of-week labels at midnight boundaries (Intl.DateTimeFormat).
// Bottom tier: time-of-day ticks at adaptive granularity.
//
// No date library — all transforms use epochToX and direct Date arithmetic.
// Tick positions computed via epochToX(tickEpoch, viewport).
//
// Refs:
//   - 09-06-PLAN.md Task 2
//   - 09-UI-SPEC.md §"Time Axis"
//   - 09-CONTEXT.md D-11, D-12
//   - 09-PATTERNS.md §"GanttAxisHeader.tsx"

import React from 'react'
import styles from './GanttAxisHeader.module.css'
import { epochToX, type GanttViewport } from '@/utils/gantt-math'
import type { EpochSeconds } from '@shared/time'

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

export interface GanttAxisHeaderProps {
  viewport: GanttViewport
  gutterWidthPct: number
}

/**
 * Return the tick interval in seconds based on viewport span (D-12).
 *
 * Brackets are tuned so the visible tick count stays readable (~12–36 labels)
 * across the full 1h–7d zoom range — in particular the default 1-day view uses
 * hourly ticks (24), not 15-minute ticks (96, which overlap into an unreadable smear).
 *
 *   span >  3 days        → 4-hour ticks
 *   span >  1 day         → 2-hour ticks
 *   span >  6 hours       → 1-hour ticks   (default 1-day view → 24 ticks)
 *   span >  2 hours       → 15-minute ticks
 *   span <= 2 hours       → 5-minute ticks
 */
export function tickIntervalFor(spanSeconds: number): number {
  if (spanSeconds > SECONDS_PER_DAY * 3) return SECONDS_PER_HOUR * 4
  if (spanSeconds > SECONDS_PER_DAY) return SECONDS_PER_HOUR * 2
  if (spanSeconds > SECONDS_PER_HOUR * 6) return SECONDS_PER_HOUR
  if (spanSeconds > SECONDS_PER_HOUR * 2) return SECONDS_PER_MINUTE * 15
  return SECONDS_PER_MINUTE * 5
}

/** Format a date for the top-tier label (e.g. "Wed 06/18"). No date library. */
function formatDateLabel(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${weekday} ${mm}/${dd}`
}

/** Format a time-of-day tick label (e.g. "14:00" or "09:30"). No date library. */
function formatTimeLabel(epochSeconds: number, tickInterval: number): string {
  const date = new Date(epochSeconds * 1000)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  // Only show minutes when tick interval < 1 hour
  if (tickInterval >= SECONDS_PER_HOUR) return `${hh}:00`
  return `${hh}:${mm}`
}

/** Enumerate midnight epoch boundaries within the viewport range. */
function getMidnightBoundaries(startEpoch: number, endEpoch: number): number[] {
  const boundaries: number[] = []
  // Start from the midnight before or at startEpoch
  const startDate = new Date(startEpoch * 1000)
  startDate.setHours(0, 0, 0, 0)
  let cursor = Math.floor(startDate.getTime() / 1000)
  while (cursor <= endEpoch) {
    boundaries.push(cursor)
    const next = new Date(cursor * 1000)
    next.setDate(next.getDate() + 1)
    cursor = Math.floor(next.getTime() / 1000)
  }
  return boundaries
}

/** Enumerate tick epochs at the given interval within the viewport range. */
function getTickEpochs(startEpoch: number, endEpoch: number, interval: number): number[] {
  const ticks: number[] = []
  // Align to a clean multiple of interval
  const firstTick = Math.ceil(startEpoch / interval) * interval
  for (let t = firstTick; t <= endEpoch; t += interval) {
    ticks.push(t)
  }
  return ticks
}

/** Sticky two-tier gantt axis header: date row (top) + time-tick row (bottom). */
export function GanttAxisHeader({ viewport, gutterWidthPct }: GanttAxisHeaderProps): JSX.Element {
  const endEpoch = viewport.startEpoch + viewport.spanSeconds
  const tickInterval = tickIntervalFor(viewport.spanSeconds)

  const midnights = getMidnightBoundaries(viewport.startEpoch, endEpoch)
  const tickEpochs = getTickEpochs(viewport.startEpoch, endEpoch, tickInterval)

  const gutterWidth = `${gutterWidthPct * 100}%`
  const trackWidth = `${(1 - gutterWidthPct) * 100}%`

  return (
    <div className={styles.header} data-testid="gantt-axis-header">
      {/* Left gutter spacer — matches the lane gutter width */}
      <div className={styles.gutterSpacer} style={{ width: gutterWidth }} />

      {/* Axis track area */}
      <div className={styles.axisTrack} style={{ width: trackWidth }}>
        {/* Top tier: date labels at midnight boundaries */}
        <div className={styles.dateTier}>
          {midnights.map((midnightEpoch) => {
            const x = epochToX(midnightEpoch as EpochSeconds, viewport)
            // Only render if within visible range
            if (x > viewport.canvasWidthPx + 100) return null
            const date = new Date(midnightEpoch * 1000)
            return (
              <div
                key={midnightEpoch}
                className={styles.dateLabel}
                style={{ left: `${Math.max(0, x)}px` }}
              >
                {formatDateLabel(date)}
                <div className={styles.midnightSeparator} />
              </div>
            )
          })}
        </div>

        {/* Bottom tier: time-of-day tick marks */}
        <div className={styles.tickTier}>
          {tickEpochs.map((tickEpoch) => {
            const x = epochToX(tickEpoch as EpochSeconds, viewport)
            if (x < -20 || x > viewport.canvasWidthPx + 20) return null
            const isMidnight = tickEpoch % SECONDS_PER_DAY === 0
            return (
              <div
                key={tickEpoch}
                className={`${styles.tick}${isMidnight ? ` ${styles.tickMidnight}` : ''}`}
                style={{ left: `${x}px` }}
              >
                <div className={styles.tickLine} />
                <span className={styles.tickLabel}>
                  {formatTimeLabel(tickEpoch, tickInterval)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
