import { useEffect, useRef, useState } from 'react'
import styles from './DescriptionCell.module.css'
import type { Timer } from '@shared/ipc'
import { useSetDescription } from '@/hooks/useSetDescription'
import { usePendingFocusStore } from '@/stores/usePendingFocusStore'
import { CopyButton } from '@/components/CopyButton'

interface DescriptionCellProps {
  timer: Timer
}

/** Editable description cell — click to edit, Enter/blur to commit, Escape to revert. */
export function DescriptionCell({ timer }: DescriptionCellProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(timer.description)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const setDescription = useSetDescription()

  // Auto-focus on the newly-added row.
  // Read primitive selectors to avoid the object-returning selector re-render trap.
  const pendingFocusId = usePendingFocusStore((s) => s.pendingFocusId)
  const clearPendingFocus = usePendingFocusStore((s) => s.clear)

  useEffect(() => {
    if (pendingFocusId === timer.id) {
      setIsEditing(true)
      // queueMicrotask defer: setIsEditing is async — the input doesn't exist in
      // the DOM yet. Defer so React commits the input element before focus fires.
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
        clearPendingFocus()
      })
    }
  }, [pendingFocusId, timer.id, clearPendingFocus])

  // Resync local draft when upstream description changes while cell is at rest.
  useEffect(() => {
    if (!isEditing) setDraft(timer.description)
  }, [timer.description, isEditing])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed !== timer.description) {
      setDescription.mutate({ id: timer.id, description: trimmed })
    }
    setIsEditing(false)
  }

  const cancel = (): void => {
    setDraft(timer.description)
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancel()
          } else if (e.key === 'Enter') {
            // Enter applies (commit); Escape reverts; blur also commits.
            e.preventDefault()
            commit()
          }
        }}
        className={styles.input}
        data-testid="description-input"
        rows={2}
        // autoFocus omitted — the pendingFocusId path uses queueMicrotask + inputRef.focus()
        // instead; direct click focuses via the same inputRef path.
      />
    )
  }

  return (
    <span className={styles.cellWrap}>
      {/* Copy button on the left since the description text is right-aligned. */}
      {timer.description && (
        <CopyButton value={timer.description} label="Copy description" />
      )}
      <span
        onClick={() => setIsEditing(true)}
        className={styles.text}
        data-testid="description-cell"
      >
        {timer.description || <span className={styles.placeholder}>(no description)</span>}
      </span>
    </span>
  )
}
