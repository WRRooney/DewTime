// src/renderer/src/components/CalendarPickerDialog.tsx
// Anchored calendar-picker POPOVER driven by useCalendarPickerStore (D-13).
//
// Was a centered modal <dialog>; now an absolutely-positioned popover that
// opens directly below the date control (anchor rect carried in the store) and
// dismisses on outside-click or Escape — lighter-weight than a modal for a
// date picker that sits under its trigger.
//
// Selecting a day calls useSelectedDateStore.setDate(d) and closes the picker
// immediately (single-click close per RESEARCH Pitfall 6). Undefined selections
// are ignored (RESEARCH A3 — mode="single" with no `required` prop).
//
// weekStartsOn maps the app WeekStart encoding to rdp's encoding (D-10 / A-23):
//   weekStart === 6 (Sunday first) → rdp weekStartsOn=0
//   weekStart === 0 (Monday first) → rdp weekStartsOn=1
//
// A-21: react-day-picker/dist/style.css imported HERE (the .tsx file), NEVER
//   in the .module.css — importing in a CSS module strips global scope and
//   causes rdp to render as a flat list (RESEARCH Pitfall 5).
//
// A-20: No date-fns / dayjs / luxon import. A-20 enforced by PLAN grep gate.
//
// Refs:
//   - 06-05-PLAN.md (this plan)
//   - 06-PATTERNS.md § CalendarPickerDialog.tsx
//   - 06-UI-SPEC.md § Calendar picker dialog
//   - 06-RESEARCH.md § Pattern 6 + Pitfall 5 + Pitfall 6

import { useEffect, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css' // A-21: MUST be in the .tsx, never in .module.css
import styles from './CalendarPickerDialog.module.css'
import { useCalendarPickerStore } from '@/stores/useCalendarPickerStore'
import { useSelectedDateStore } from '@/stores/useSelectedDateStore'
import { useSettings } from '@/contexts/SettingsContext'

/** Approx popover width (px) — keeps the anchored left edge on-screen near the viewport edge. */
const POPOVER_WIDTH = 280

/** Anchored calendar-picker popover driven by the calendar picker store. */
export function CalendarPickerDialog(): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null)
  const isOpen = useCalendarPickerStore((s) => s.isOpen)
  const anchor = useCalendarPickerStore((s) => s.anchor)
  const close = useCalendarPickerStore((s) => s.close)
  const selectedDate = useSelectedDateStore((s) => s.date)
  const { weekStart } = useSettings()

  // Dismiss on outside-click (mousedown) or Escape — listeners live only while open.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, close])

  // DayPicker measures layout on render — only mount it while open (a hidden
  // zero-size mount re-measured on every selectedDate change and froze the
  // renderer). Returning null while closed keeps it unmounted entirely.
  if (!isOpen) return null

  // Anchor directly below the trigger; clamp the left edge to stay on-screen.
  const left = anchor
    ? Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8))
    : 8
  const top = anchor ? anchor.bottom + 4 : 8

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Choose date"
      aria-modal="false"
      className={styles.popover}
      style={{ top, left }}
    >
      <DayPicker
        mode="single"
        selected={selectedDate}
        onSelect={(d) => {
          if (d) {
            useSelectedDateStore.getState().setDate(d)
            useCalendarPickerStore.getState().close()
          }
        }}
        weekStartsOn={weekStart === 6 ? 0 : 1} // D-10 mapping: app 0=Mon→rdp 1, app 6=Sun→rdp 0
        // `?? ''` because noUncheckedIndexedAccess types CSS-module access as
        // string|undefined, and DayPicker's className is strictly `string`.
        className={styles.picker ?? ''}
      />
    </div>
  )
}
