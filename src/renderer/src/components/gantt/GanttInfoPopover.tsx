// GanttInfoPopover: ⓘ hover info button showing gesture/action reference table.
//
// Trigger: circle-i icon button (16px), positioned top-right in the gantt axis area.
// Popover: appears on hover (300ms delay), closes on mouse-leave (200ms delay).
// Content: gesture → action table from UI-SPEC copywriting contract.
//
// No Radix/external — pure CSS-modules hover popover.
//
// Refs:
//   - 09-06-PLAN.md Task 2
//   - 09-UI-SPEC.md §"Info Popover"
//   - 09-PATTERNS.md §"GanttInfoPopover" (No Analog — use UI-SPEC)

import { useState, useRef, useEffect } from 'react'
import styles from './GanttInfoPopover.module.css'

// Gesture table from UI-SPEC §"Copywriting Contract"
// Each entry is displayed as: "{gesture} → {action}"
const GESTURES: Array<{ label: string }> = [
  { label: 'Scroll over time axis → Zoom in/out' },
  { label: 'Shift + Scroll over time axis → Pan' },
  { label: 'Scroll over lanes → Scroll timers' },
  { label: 'Drag empty space → Pan' },
  { label: 'Drag bar edge → Resize' },
  { label: 'Drag bar → Move' },
  { label: 'Double-click lane → Add entry' },
  { label: 'Double-click bar → Edit timestamps' },
  { label: 'Stop icon → Stop timer' },
  { label: 'Right-click bar → Options' },
]

/** Hover info popover — shows gesture reference table on 300ms hover delay. */
export function GanttInfoPopover(): JSX.Element {
  const [visible, setVisible] = useState(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel any pending show/hide timers on unmount so they can't fire after teardown.
  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current)
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const handleMouseEnter = (): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    showTimerRef.current = setTimeout(() => {
      setVisible(true)
    }, 300)
  }

  const handleMouseLeave = (): void => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    hideTimerRef.current = setTimeout(() => {
      setVisible(false)
    }, 200)
  }

  return (
    <div
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* ⓘ trigger button */}
      <button
        type="button"
        className={styles.trigger}
        aria-label="Keyboard and gesture shortcuts"
        aria-expanded={visible}
        tabIndex={0}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        {/* Circle-i SVG — 16px per UI-SPEC */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="7" />
          <line x1="8" y1="7" x2="8" y2="11" />
          <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Gesture reference popover */}
      {visible && (
        <div className={styles.popover} role="tooltip">
          <ul className={styles.gestureList}>
            {GESTURES.map(({ label }) => (
              <li key={label} className={styles.gestureRow}>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
