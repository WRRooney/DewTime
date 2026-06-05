// src/renderer/src/hooks/useColumnWidths.ts
// Persistent, percentage-based column widths for the timer table.
//
// Widths are stored as PERCENTAGES (summing to 100) so columns scale with the
// window, and persisted to localStorage so adjustments survive an app restart.
// localStorage (not the SQLite settings table) is deliberate: column widths are
// pure renderer view-state, not an app preference synced to the main process —
// the settings.* IPC contract is a strict Zod discriminated union reserved for
// real app settings (week_start, window_geometry, …).
//
// TanStack Table's built-in column sizing is px-based and would fight the
// percentage requirement, so the table renders a <colgroup> from these
// percentages and drives resize via manual drag handles (see TimerTable.tsx).

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'timerz.columnWidths.v1'

/** Smallest width any single column may be dragged to (percent). */
export const MIN_COLUMN_PCT = 5

type Widths = Record<string, number>

/** Normalize a width map to exactly the given columns, scaled to sum 100. */
function normalize(order: string[], raw: Partial<Widths>, defaults: Widths): Widths {
  // Use stored value when present and finite, else the default for that column.
  const picked: Widths = {}
  for (const id of order) {
    const v = raw[id]
    picked[id] = typeof v === 'number' && isFinite(v) && v > 0 ? v : (defaults[id] ?? 0)
  }
  const sum = order.reduce((acc, id) => acc + (picked[id] ?? 0), 0)
  if (sum <= 0) return { ...defaults }
  // Scale to 100 so rounding drift / a changed column set can't desync the row.
  const scaled: Widths = {}
  for (const id of order) scaled[id] = ((picked[id] ?? 0) / sum) * 100
  return scaled
}

function load(order: string[], defaults: Widths): Widths {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...defaults }
    const parsed = JSON.parse(stored) as Partial<Widths>
    // If the stored shape is missing any current column, normalize fills it
    // from defaults — handles a column being added/removed across versions.
    const hasAll = order.every((id) => typeof parsed?.[id] === 'number')
    if (!hasAll) return { ...defaults }
    return normalize(order, parsed, defaults)
  } catch {
    return { ...defaults }
  }
}

export interface UseColumnWidths {
  /** Current per-column widths in percent (sum ≈ 100). */
  widths: Widths
  /** Replace widths in memory (not persisted) — used during an active drag. */
  setWidths: (next: Widths) => void
  /** Persist the current widths to localStorage — call on drag end. */
  persist: (next: Widths) => void
  /** Reset to defaults and persist. */
  reset: () => void
}

/**
 * Owns the persistent percentage widths for a fixed set of columns.
 *
 * @param order      column ids, left → right
 * @param defaults   default percent per column (should sum to 100)
 */
export function useColumnWidths(order: string[], defaults: Widths): UseColumnWidths {
  const [widths, setWidthsState] = useState<Widths>(() => load(order, defaults))

  const setWidths = useCallback((next: Widths) => setWidthsState(next), [])

  const persist = useCallback((next: Widths) => {
    setWidthsState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private mode / quota — widths just won't persist; not fatal.
    }
  }, [])

  const reset = useCallback(() => {
    setWidthsState({ ...defaults })
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [defaults])

  return { widths, setWidths, persist, reset }
}
