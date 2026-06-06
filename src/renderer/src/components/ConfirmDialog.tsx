// Native <dialog> confirmation modal for destructive timer deletion.
//
// Open/close is driven reactively by useConfirmDeleteStore (Zustand slice) —
// NOT via a parent-supplied ref like SettingsDialog. When `pendingDelete`
// becomes non-null the dialog opens via showModal(); when it returns to null
// the dialog closes. This keeps the caller (DeleteCell) as a simple fire-and-
// forget store.open() call with no imperative ref passing.
//
// Cancel → useConfirmDeleteStore.close() → no IPC call.
// Delete → useDeleteTimer.mutateAsync(pendingDelete.id) → close on settled
//          (success or error). Errors surface in devtools + electron-log only.
// ESC    → native `cancel` event fires → onCancel handler runs close().

import { useEffect, useRef } from 'react'
import styles from './ConfirmDialog.module.css'
import { useConfirmDeleteStore } from '@/stores/useConfirmDeleteStore'
import { useDeleteTimer } from '@/hooks/useDeleteTimer'

/** Generic native-<dialog> confirmation modal driven by useConfirmDeleteStore. */
export function ConfirmDialog(): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingDelete = useConfirmDeleteStore((s) => s.pendingDelete)
  const close = useConfirmDeleteStore((s) => s.close)
  const deleteTimer = useDeleteTimer()

  // Reactive open/close in response to store state.
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (pendingDelete && !d.open) d.showModal()
    if (!pendingDelete && d.open) d.close()
  }, [pendingDelete])

  const handleCancel = (): void => {
    close()
  }

  const handleConfirm = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      await deleteTimer.mutateAsync(pendingDelete.id)
    } finally {
      close()
    }
  }

  const label = pendingDelete?.label ?? ''

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={handleCancel} onClose={handleCancel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Delete timer?</h2>
      </header>
      <div className={styles.body}>
        <p className={styles.copy}>
          Delete timer &quot;{label}&quot;? This also removes its time entries.
        </p>
      </div>
      <footer className={styles.footer}>
        {/* Cancel is left (first focusable) so Enter on focused Cancel cancels */}
        <button type="button" className={styles.btn} onClick={handleCancel}>Cancel</button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={() => { void handleConfirm() }}
        >Delete</button>
      </footer>
    </dialog>
  )
}
