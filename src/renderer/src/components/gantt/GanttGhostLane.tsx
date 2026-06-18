// GanttGhostLane: pinned bottom "New timer" add-lane.
//
// D-22: ghost lane creates a new timer via useCreateTimer on click or double-click.
//
// Layout: 32px fixed height, dashed top border, "+" icon + "New timer" text.
// Pinned below the scrollable lane area (not inside scroll).
//
// Refs:
//   - 09-06-PLAN.md Task 2
//   - 09-UI-SPEC.md §"Ghost Add-Lane"
//   - 09-CONTEXT.md D-22

import styles from './GanttGhostLane.module.css'

export interface GanttGhostLaneProps {
  onAddTimer: () => void
}

/** Pinned bottom row — click or double-click creates a new timer (D-22). */
export function GanttGhostLane({ onAddTimer }: GanttGhostLaneProps): JSX.Element {
  return (
    <button
      type="button"
      className={styles.ghostLane}
      onClick={onAddTimer}
      onDoubleClick={onAddTimer}
      data-testid="gantt-ghost-lane"
      aria-label="New timer"
    >
      {/* Plus icon — 14px per UI-SPEC */}
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
        <path d="M7 2v10M2 7h10" />
      </svg>
      <span className={styles.label}>New timer</span>
    </button>
  )
}
