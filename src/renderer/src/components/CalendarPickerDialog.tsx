// Anchored calendar-picker popover driven by useCalendarPickerStore. Opens
// directly below the date control (anchor rect carried in the store); dismisses
// on outside-click or Escape.
//
// Selecting a day calls useSelectedDateStore.setDate(d) and closes the picker
// immediately (single-click close). Undefined selections are ignored
// (mode="single" with no `required` prop).
//
// weekStartsOn maps the app WeekStart encoding to rdp's encoding:
//   weekStart === 6 (Sunday first) → rdp weekStartsOn=0
//   weekStart === 0 (Monday first) → rdp weekStartsOn=1
//
// react-day-picker/dist/style.css is imported in this .tsx file, NEVER in
// .module.css — importing in a CSS module strips global scope and causes rdp
// to render as a flat list. No date-fns / dayjs / luxon import.

import { useEffect, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css' // MUST be in the .tsx, never in .module.css (strips global scope)
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

  // Only mount DayPicker while open — a hidden zero-size mount re-measured on
  // every selectedDate change and froze the renderer.
  if (!isOpen) return null

  // Anchor below the trigger; clamp left edge to stay on-screen.
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
        weekStartsOn={weekStart === 6 ? 0 : 1} // app 0=Mon→rdp 1, app 6=Sun→rdp 0
        // `?? ''` because noUncheckedIndexedAccess types CSS-module access as
        // string|undefined, and DayPicker's className is strictly `string`.
        className={styles.picker ?? ''}
      />
    </div>
  )
}
