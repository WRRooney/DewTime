// Gantt viewport store — keeps zoom/pan state alive across tab switches.
//
// GanttView unmounts when the user switches to the Timers/Projects tabs (App.tsx
// renders one tab at a time). Holding the viewport in local component state would
// reset zoom/pan on every remount. This in-memory store preserves it for the session
// (NOT persisted to SQLite — a fresh app launch starts on the current day).
//
// `lastDateKey` records which calendar day the viewport is currently centered on, so
// GanttView only re-centers (resetting span to default) when the selected date actually
// changes — not on every remount, which would defeat the persistence.

import { create } from 'zustand'
import { DEFAULT_SPAN_SECONDS } from '@/utils/gantt-math'

interface GanttViewportState {
  startEpoch: number
  spanSeconds: number
  canvasWidthPx: number
  /** YYYY-MM-DD key of the day the viewport was last centered on (null before first center). */
  lastDateKey: string | null
  setStartEpoch: (startEpoch: number) => void
  setZoom: (startEpoch: number, spanSeconds: number) => void
  setCanvasWidth: (canvasWidthPx: number) => void
  /** Re-center on a new day: jump to its start and reset span to the default 1-day view. */
  recenter: (startEpoch: number, dateKey: string) => void
}

export const useGanttViewportStore = create<GanttViewportState>((set) => ({
  startEpoch: 0,
  spanSeconds: DEFAULT_SPAN_SECONDS,
  canvasWidthPx: 0,
  lastDateKey: null,
  setStartEpoch: (startEpoch) => set({ startEpoch }),
  setZoom: (startEpoch, spanSeconds) => set({ startEpoch, spanSeconds }),
  setCanvasWidth: (canvasWidthPx) => set({ canvasWidthPx }),
  recenter: (startEpoch, dateKey) =>
    set({ startEpoch, spanSeconds: DEFAULT_SPAN_SECONDS, lastDateKey: dateKey }),
}))
