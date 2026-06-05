// src/renderer/src/stores/useCalendarPickerStore.ts
// Zustand v5 store for the calendar picker dialog open/close state (D-13).
//
// Mirrors useConfirmDeleteStore's open/close shape — boolean flag only.
// Opens the shared <CalendarPickerDialog /> via open(); dialog closes itself
// by calling close() after the user selects a date or clicks Close.
//
// NO middleware (no devtools, no persist) per D-13.
//
// Refs:
//   - 06-CONTEXT.md D-13
//   - 06-02-PLAN.md Task 1

import { create } from 'zustand'

/** Viewport-coordinate rect of the trigger (from getBoundingClientRect) so the
 *  popover can anchor directly below the clicked date control. */
export interface CalendarAnchor {
  left: number
  bottom: number
  width: number
}

interface CalendarPickerState {
  /** True while the calendar picker popover is open. */
  isOpen: boolean
  /** Trigger rect for popover positioning; null → fall back to a centered position. */
  anchor: CalendarAnchor | null
  /** Open the calendar picker, optionally anchored to a trigger rect. */
  open: (anchor?: CalendarAnchor | null) => void
  /** Close the calendar picker. */
  close: () => void
}

export const useCalendarPickerStore = create<CalendarPickerState>((set) => ({
  isOpen: false,
  anchor: null,
  open: (anchor = null) => set({ isOpen: true, anchor }),
  close: () => set({ isOpen: false }),
}))
