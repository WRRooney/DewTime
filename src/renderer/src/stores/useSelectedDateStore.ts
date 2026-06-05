// src/renderer/src/stores/useSelectedDateStore.ts
// Zustand v5 store for the currently-viewed date (D-13).
//
// Drives the date-nav toolbar (prev/next/today), the calendar picker (setDate),
// and both TanStack Query date-scoped hooks (useDayTimers, useWeekTimers).
//
// A-22: today() MUST call new Date() at invocation time — never a cached Date.
// NO middleware (no devtools, no persist) per D-13.
//
// Refs:
//   - 06-CONTEXT.md D-13
//   - 06-RESEARCH.md § Pattern 1

import { create } from 'zustand'

interface SelectedDateState {
  /** The currently selected date shown in the toolbar and used for query scoping. */
  date: Date
  /** Set the store date to an arbitrary date (used by CalendarPickerDialog). */
  setDate: (d: Date) => void
  /** Navigate to the previous calendar day (copies the Date — no in-place mutation). */
  prev: () => void
  /** Navigate to the next calendar day (copies the Date — no in-place mutation). */
  next: () => void
  /** Navigate to today. A-22: evaluates new Date() at invocation time — never cached. */
  today: () => void
}

export const useSelectedDateStore = create<SelectedDateState>((set) => ({
  date: new Date(),
  setDate: (d) => set({ date: d }),
  prev: () =>
    set((s) => {
      const d = new Date(s.date)
      d.setDate(d.getDate() - 1)
      return { date: d }
    }),
  next: () =>
    set((s) => {
      const d = new Date(s.date)
      d.setDate(d.getDate() + 1)
      return { date: d }
    }),
  today: () => set({ date: new Date() }), // new Date() evaluated at click time (A-22)
}))
