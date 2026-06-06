// today() calls new Date() at invocation time — never a cached Date.

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
  /** Navigate to today. Evaluates new Date() at invocation time — never cached. */
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
  today: () => set({ date: new Date() }), // new Date() evaluated at click time
}))
