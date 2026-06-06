// Swap-to-input editable cell for a project's billing number.
//
// No project assigned → static muted "—", clicking does nothing.
// Project assigned → click enters edit mode; Enter/blur commits, Escape reverts.
// Commit calls projects.updateNumber(timer.project_id, draft.trim() || null).
// project_number is resolved client-side from the useProjects() cache (no JOIN).
// No auto-focus on new rows (unlike DescriptionCell). Not a tick-store subscriber.

import { useEffect, useRef, useState } from 'react'
import styles from './ProjectNumberCell.module.css'
import type { Timer } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useUpdateProjectNumber } from '@/hooks/useUpdateProjectNumber'
import { CopyButton } from '@/components/CopyButton'

interface ProjectNumberCellProps {
  timer: Timer
}

/** Editable project number cell — no-op when no project is assigned, swap-to-input otherwise. */
export function ProjectNumberCell({ timer }: ProjectNumberCellProps): JSX.Element {
  const { data: projects } = useProjects()
  const updateNumber = useUpdateProjectNumber()

  // Resolve the current project's number from the shared cache (no JOIN).
  const currentProject = timer.project_id !== null
    ? (projects ?? []).find((p) => p.id === timer.project_id)
    : undefined
  const currentNumber = currentProject?.project_number ?? null

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(currentNumber ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Resync draft when project assignment or number changes while not editing.
  useEffect(() => {
    if (!isEditing) {
      setDraft(currentNumber ?? '')
    }
  }, [timer.project_id, currentNumber, isEditing])

  // Focus + select after the <input> is committed to the DOM — queueMicrotask
  // could fire before React commits, leaving inputRef null and the field unfocused.
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const commit = (): void => {
    const trimmed = draft.trim()
    const original = currentNumber ?? ''
    if (trimmed !== original && timer.project_id !== null) {
      updateNumber.mutate({ id: timer.project_id, number: trimmed || null })
    }
    setIsEditing(false)
  }

  const cancel = (): void => {
    setDraft(currentNumber ?? '')
    setIsEditing(false)
  }

  // No project assigned — render a static muted dash, clicking does nothing.
  if (timer.project_id === null) {
    return <span className={styles.emptyNoProject}>&#x2014;</span>
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        className={styles.input}
        // focus is triggered imperatively via useEffect when isEditing flips
      />
    )
  }

  // Project assigned — rest state; clicking the text enters edit mode, the copy
  // button (shown only when a number exists) copies the billing number.
  return (
    <span className={styles.cellWrap}>
      <span
        onClick={() => {
          // focus/select happens in the isEditing useEffect after the input commits.
          setIsEditing(true)
        }}
        className={styles.text}
      >
        {currentNumber !== null
          ? currentNumber
          : <span className={styles.placeholder}>&#x2014;</span>}
      </span>
      {currentNumber !== null && (
        <CopyButton value={currentNumber} label="Copy project number" />
      )}
    </span>
  )
}
