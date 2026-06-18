// useGutterWidth: read/write gutter width percent via SQLite settings (D-16).
//
// Persists to SQLite settings table — NOT browser storage. Browser-based storage is
// forbidden for this setting (see STATE.md and 09-PATTERNS.md §Settings Read/Write).
//
// The hook provides:
//   widthPct   — current width as a [0,1] percent (default 0.25)
//   setWidthPct — in-memory update during drag (no IPC — avoids thrash)
//   persist     — write the current value to SQLite on drag-end
//
// Clamp: [0.10, 0.50] enforced on persist (min 120px/1200px canvas = 0.10,
// max 50% of canvas = 0.50). The authoritative server-side clamp lives in
// SetArgsSchema z.number().min(0).max(1) (plan 09-01), so any render-side
// drift does not bypass the IPC boundary validation.

import { useState, useEffect } from 'react'

const DEFAULT_GUTTER_PCT = 0.25
const MIN_GUTTER_PCT = 0.10
const MAX_GUTTER_PCT = 0.50

export interface UseGutterWidthResult {
  /** Current gutter width as a fraction [0,1] of the canvas width. */
  widthPct: number
  /** Update in-memory during drag (no IPC call). */
  setWidthPct: (pct: number) => void
  /** Write the current value to SQLite settings — call on drag-end. */
  persist: () => void
}

/** Hook for gutter-width percentage state with SQLite read-on-mount and write-on-drag-end. */
export function useGutterWidth(): UseGutterWidthResult {
  const [widthPct, setWidthPct] = useState(DEFAULT_GUTTER_PCT)

  // Load persisted value on mount (one-time read)
  useEffect(() => {
    void window.api.settings.get('settings.gutter_width_pct')
      .then((value) => {
        if (typeof value === 'number' && isFinite(value) && value > 0) {
          setWidthPct(Math.min(MAX_GUTTER_PCT, Math.max(MIN_GUTTER_PCT, value)))
        }
      })
      .catch(() => {
        // settings key not yet seeded — keep default
      })
  }, [])

  const persist = (): void => {
    const clamped = Math.min(MAX_GUTTER_PCT, Math.max(MIN_GUTTER_PCT, widthPct))
    void window.api.settings.set('settings.gutter_width_pct', clamped)
  }

  return { widthPct, setWidthPct, persist }
}
