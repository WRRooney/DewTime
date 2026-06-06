// "+ Add Timer" toolbar button. Click → useCreateTimer.mutateAsync({ projectId: null,
// description: '' }). On success, sets usePendingFocusStore.pendingFocusId so the new
// row's DescriptionCell auto-focuses on mount. IPC errors surface in devtools/log.

import styles from './AddTimerButton.module.css'
import { useCreateTimer } from '@/hooks/useCreateTimer'

/** "+ Add Timer" toolbar button. Click creates a new blank timer. */
export function AddTimerButton(): JSX.Element {
  const createTimer = useCreateTimer()

  const handleClick = (): void => {
    void createTimer.mutateAsync({ projectId: null, description: '' })
  }

  return (
    <button type="button" className={styles.addBtn} onClick={handleClick}>
      {/* Plus glyph */}
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
