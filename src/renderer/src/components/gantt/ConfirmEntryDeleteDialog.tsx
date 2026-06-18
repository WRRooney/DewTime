// ConfirmEntryDeleteDialog: native <dialog> for deleting a time entry.
//
// This mirrors ConfirmDialog.tsx exactly but drives useDeleteEntry (NOT useDeleteTimer).
// This resolves the PATTERNS "No Analog Found" gap: ConfirmDialog is hardwired to
// useDeleteTimer, so a parallel dialog is needed for entry-level deletion.
//
// Open/close driven reactively by useConfirmDeleteEntryStore (Zustand).
// When pendingDelete becomes non-null the dialog opens; when null it closes.
//
// Cancel → close() → no IPC call
// Delete → useDeleteEntry.mutateAsync({ entryId }) → close in finally
// ESC    → native 'cancel' event fires → close()
//
// The gantt key invalidation lives in useDeleteEntry itself (patched by plan 09-03).
// This dialog drives useDeleteEntry.mutateAsync and adds no invalidation of its own.
//
// Copy (D-24, UI-SPEC Copywriting Contract):
//   Title: "Delete entry?"
//   Body:  "This will permanently remove the time entry. This cannot be undone."
//   Button: "Delete"

import { useEffect, useRef } from 'react'
import styles from './ConfirmEntryDeleteDialog.module.css'
import { useConfirmDeleteEntryStore } from '@/stores/useConfirmDeleteEntryStore'
import { useDeleteEntry } from '@/hooks/useDeleteEntry'

/** Native-<dialog> confirmation modal for entry deletion, driven by useConfirmDeleteEntryStore. */
export function ConfirmEntryDeleteDialog(): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingDelete = useConfirmDeleteEntryStore((s) => s.pendingDelete)
  const close = useConfirmDeleteEntryStore((s) => s.close)
  const deleteEntry = useDeleteEntry()

  // Reactive open/close in response to store state
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
      await deleteEntry.mutateAsync({ entryId: pendingDelete.id })
    } finally {
      close()
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={handleCancel} onClose={handleCancel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Delete entry?</h2>
      </header>
      <div className={styles.body}>
        <p className={styles.copy}>
          This will permanently remove the time entry. This cannot be undone.
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
