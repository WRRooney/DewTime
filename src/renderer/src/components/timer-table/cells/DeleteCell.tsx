// src/renderer/src/components/timer-table/cells/DeleteCell.tsx
// × icon button that opens the ConfirmDialog for timer deletion (UI-SPEC § DeleteCell).
//
// Click → useConfirmDeleteStore.getState().open(timer.id, label). Uses .getState()
// (not the hook) because this is an emit-only caller — no subscription needed.
//
// SVG path reused verbatim from Phase 3 TitleBar close button:
//   d="M3.5 3.5l9 9M12.5 3.5l-9 9" (UI-SPEC § Inline SVG: DeleteCell reuses close glyph)
//
// Destructive intent signaled by stroke color flip on :hover (--color-fg-muted → --color-danger),
// NOT by a background wash. This matches UI-SPEC § DeleteCell hover note.
//
// Refs:
//   - 04-UI-SPEC.md § DeleteCell (click → confirm store; × glyph; hover behavior)
//   - 04-PATTERNS.md § DeleteCell (analog: TitleBar.tsx close button)
//   - Anti-pattern A-13: this cell does NOT import the tick store (DurationCell only)
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

import styles from './DeleteCell.module.css'
import type { Timer } from '@shared/ipc'
import { useConfirmDeleteStore } from '@/stores/useConfirmDeleteStore'

interface DeleteCellProps {
  timer: Timer
}

/** × icon button opening ConfirmDialog via useConfirmDeleteStore.getState().open (UI-SPEC § DeleteCell). */
export function DeleteCell({ timer }: DeleteCellProps): JSX.Element {
  const handleClick = (): void => {
    useConfirmDeleteStore.getState().open(timer.id, timer.description || '(no description)')
  }

  return (
    <button
      type="button"
      className={styles.btn}
      aria-label="Delete timer"
      onClick={handleClick}
    >
      {/* × close glyph — reused verbatim from Phase 3 TitleBar close button (UI-SPEC § DeleteCell) */}
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
        <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
      </svg>
    </button>
  )
}
