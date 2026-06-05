// src/renderer/src/components/DateNavToolbar.tsx
// Date-navigation toolbar row (prev/Today/next buttons, selected-date label,
// calendar-open button, and Day:/Week: live total readouts).
//
// Wire-up summary:
//   - useSelectedDateStore → prev/next/today actions + selected date for label
//   - useCalendarPickerStore → open (calendar-open button)
//   - useSettings() → weekStart for weekRangeOf() (no date library — A-20)
//   - dayRangeOf / weekRangeOf → epoch boundaries passed to DailyTotal / WeeklyTotal
//   - isToday computed at render via new Date() — never cached (D-13)
//
// All SVG icons are inline (A-02: no icon library; D-02: icon libraries forbidden).
// Arrow geometry from 06-PATTERNS.md § SVG geometry for Phase 6 buttons.
//
// A-20: Native Intl.DateTimeFormat for the date label — no date-fns/dayjs/luxon.
// A-01: All colors in DateNavToolbar.module.css are var(--*) only — no hex/HSL literals.
//
// Refs:
//   - 06-04-PLAN.md Task 3
//   - 06-PATTERNS.md § DateNavToolbar.tsx
//   - 06-UI-SPEC.md § Date-navigation toolbar row

import styles from './DateNavToolbar.module.css'
import { useSelectedDateStore } from '@/stores/useSelectedDateStore'
import { useCalendarPickerStore } from '@/stores/useCalendarPickerStore'
import { useSettings } from '@/contexts/SettingsContext'
import { dayRangeOf, weekRangeOf } from '@/utils/date-ranges'
import { DailyTotal } from './DailyTotal'
import { WeeklyTotal } from './WeeklyTotal'
import type { WeekStart } from '@/contexts/SettingsContext'

// A-20: Native Intl.DateTimeFormat — no date library required.
// Fixed-width layout: 3-char weekday + zero-padded MM/DD/YYYY so the label
// never changes width between days (e.g. "Mon - 06/05/2026"). Monospace +
// 2-digit fields keep every date the same pixel width.
function formatSelectedDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${weekday} - ${mm}/${dd}/${yyyy}`
}

/**
 * Date-navigation toolbar row: prev/Today/next buttons, selected-date label,
 * calendar-open button, and Day:/Week: live total readouts.
 */
export function DateNavToolbar(): JSX.Element {
  const { date: selectedDate, prev, next, today } = useSelectedDateStore()
  const { weekStart } = useSettings()
  const openCalendar = useCalendarPickerStore((s) => s.open)

  const dayRange  = dayRangeOf(selectedDate)
  const weekRange = weekRangeOf(selectedDate, weekStart as WeekStart)

  // D-13 / A-22: Computed at render time — NEVER cached; reflects the live current date.
  const isToday = selectedDate.toDateString() === new Date().toDateString()

  return (
    <div className={styles.dateNavToolbar}>
      {/* Title row: "Timers" screen heading + the week-total accent chip (Ignition header). */}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Timers</h1>
        <span className={styles.weekTotalLabel}>Week total</span>
        <span className={styles.weekPill}>
          <WeeklyTotal
            fromEpoch={weekRange.fromEpoch}
            toEpoch={weekRange.toEpoch}
            className={styles.weekPillValue}
          />
        </span>
      </div>

      {/* Nav row: ◀ date ▶, then a conditional "Jump to Today", then day total. */}
      <div className={styles.navRow}>
        {/* Previous day button */}
        <button
          type="button"
          className={styles.navBtn}
          aria-label="Previous day"
          onClick={prev}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M10 2L4 7l6 5" />
          </svg>
        </button>

        {/* Selected date — sits BETWEEN the arrows; click opens the calendar picker. */}
        <button
          type="button"
          className={styles.dateBtn}
          aria-label="Open calendar picker"
          title="Pick a date"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openCalendar({ left: r.left, bottom: r.bottom, width: r.width })
          }}
        >
          {formatSelectedDate(selectedDate)}
        </button>

        {/* Next day button */}
        <button
          type="button"
          className={styles.navBtn}
          aria-label="Next day"
          onClick={next}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M4 2l6 5-6 5" />
          </svg>
        </button>

        {/* Jump to Today — only shown when the selected date is NOT today (D-13). */}
        {!isToday && (
          <button
            type="button"
            className={styles.jumpTodayBtn}
            onClick={today}
          >
            Jump to Today
          </button>
        )}

        {/* Spacer pushes the day-total readout to the right edge. */}
        <span className={styles.spacer} />

        {/* Day total — right-aligned readout on the nav row (Ignition "Date total:"). */}
        <span className={styles.dayTotalLabel}>Date total</span>
        <DailyTotal
          fromEpoch={dayRange.fromEpoch}
          toEpoch={dayRange.toEpoch}
          className={styles.dayTotalValue}
        />
      </div>
    </div>
  )
}
