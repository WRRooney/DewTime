// src/renderer/src/components/AddTimerButton.tsx
// "+ Add Timer" toolbar button that creates a new timer (D-23).
//
// Click → useCreateTimer.mutateAsync({ projectId: null, description: '' }).
// On success, useCreateTimer.onSuccess sets usePendingFocusStore.pendingFocusId
// so the new row's DescriptionCell auto-focuses on mount (plan 04-08).
//
// No error toast in Phase 4 — IPC errors surface in devtools + electron-log (D-24).
// The visible label "Add Timer" IS the accessible name; no aria-label needed.
//
// Refs:
//   - 04-CONTEXT.md D-23 (create args + auto-focus flow)
//   - 04-UI-SPEC.md § Add Timer toolbar (exact copy + SVG path)
//   - 04-PATTERNS.md § AddTimerButton
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

import styles from './AddTimerButton.module.css'
import { useCreateTimer } from '@/hooks/useCreateTimer'

/** "+ Add Timer" toolbar button. Click creates a new blank timer (D-23). */
export function AddTimerButton(): JSX.Element {
  const createTimer = useCreateTimer()

  const handleClick = (): void => {
    void createTimer.mutateAsync({ projectId: null, description: '' })
  }

  return (
    <button type="button" className={styles.addBtn} onClick={handleClick}>
      {/* Plus glyph: UI-SPEC § Inline SVG plus path d="M6 1.5v9M1.5 6h9" */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 1.5v9M1.5 6h9" />
      </svg>
      Add Timer
    </button>
  )
}
