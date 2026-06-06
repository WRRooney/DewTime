import styles from './DeleteCell.module.css'
import type { Timer } from '@shared/ipc'
import { useConfirmDeleteStore } from '@/stores/useConfirmDeleteStore'

interface DeleteCellProps {
  timer: Timer
}

/** × icon button that opens ConfirmDialog via useConfirmDeleteStore.getState().open. */
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
      {/* × close glyph — same path as TitleBar close button */}
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
