// Pure functions: epoch↔pixel viewport transform and zoom-aware snap math.
//
// Raw wall-clock access is FORBIDDEN here — this module is pure and must
// never read the current time directly. All epoch values are supplied by
// callers (useTickStore or caller-owned state). No imports of stores, IPC, or React.
//
// All arithmetic operates on epoch-seconds (integers or floats). Pixel values
// are plain numbers. No date-library imports — all transforms are direct math.
//
// Exported constants (D-07/D-08):
//   MIN_SPAN_SECONDS   — minimum viewport span (1 hour = 3600s)
//   MAX_SPAN_SECONDS   — maximum viewport span (7 days = 604800s)
//   DEFAULT_SPAN_SECONDS — initial viewport span (current day = 86400s)

import type { EpochSeconds } from '@shared/time'

/**
 * Describes the currently visible time window on the gantt canvas.
 *
 * - startEpoch: the epoch (in seconds) at the LEFT edge of the canvas
 * - spanSeconds: total seconds visible (clamped: MIN_SPAN_SECONDS..MAX_SPAN_SECONDS)
 * - canvasWidthPx: current pixel width of the bar-track rendering area
 */
export interface GanttViewport {
  startEpoch: EpochSeconds
  spanSeconds: number
  canvasWidthPx: number
}

/** Minimum viewport span: 1 hour (D-08) */
export const MIN_SPAN_SECONDS = 3600

/** Maximum viewport span: 7 days (D-08) */
export const MAX_SPAN_SECONDS = 604800

/** Default viewport span: current calendar day (D-07) */
export const DEFAULT_SPAN_SECONDS = 86400

/**
 * Map an epoch (seconds) to a pixel x-position within the viewport.
 *
 * Left edge (startEpoch) → x=0
 * Right edge (startEpoch + spanSeconds) → x=canvasWidthPx
 *
 * Values outside [0, canvasWidthPx] are off-canvas (caller decides clipping).
 * D-06: continuous horizontal transform.
 */
export function epochToX(epoch: EpochSeconds, vp: GanttViewport): number {
  return ((epoch - vp.startEpoch) / vp.spanSeconds) * vp.canvasWidthPx
}

/**
 * Inverse of epochToX: map a pixel x-position back to an epoch (seconds).
 *
 * xToEpoch(epochToX(e, vp), vp) ≈ e (within 1s for a 86400s/1000px viewport).
 * D-06: continuous horizontal transform.
 */
export function xToEpoch(x: number, vp: GanttViewport): EpochSeconds {
  return (vp.startEpoch + (x / vp.canvasWidthPx) * vp.spanSeconds) as EpochSeconds
}

/**
 * Snap an epoch to the nearest grid increment.
 *
 * When altKey is true (Alt key held), the epoch is returned unchanged — this
 * enables free-drag without snapping (D-18 Alt free-drag).
 *
 * When altKey is false, rounds to Math.round(epoch / snapIncrement) * snapIncrement.
 */
export function snapEpoch(
  epoch: EpochSeconds,
  snapIncrement: number,
  altKey: boolean,
): EpochSeconds {
  if (altKey) return epoch
  return (Math.round(epoch / snapIncrement) * snapIncrement) as EpochSeconds
}

/**
 * Return the appropriate snap-grid increment (in seconds) for a given viewport span.
 *
 * Brackets (D-27 zoom-aware grid):
 *   span <=  3600s (1h)   → 60s   (1 min)
 *   span <= 10800s (3h)   → 300s  (5 min)
 *   span <= 43200s (12h)  → 900s  (15 min)
 *   span <= 86400s (1 day) → 1800s (30 min)
 *   span >  86400s        → 3600s (1 hour)
 */
export function snapIncrementFor(spanSeconds: number): number {
  if (spanSeconds <= 3600) return 60
  if (spanSeconds <= 3600 * 3) return 300
  if (spanSeconds <= 3600 * 12) return 900
  if (spanSeconds <= 86400) return 1800
  return 3600
}
