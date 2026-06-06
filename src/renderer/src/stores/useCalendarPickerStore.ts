
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
