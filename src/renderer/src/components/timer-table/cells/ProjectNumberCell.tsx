// src/renderer/src/components/timer-table/cells/ProjectNumberCell.tsx
// Swap-to-input editable cell for a project's billing number (D-04 / PROJ-04).
//
// Rest state (no project assigned):
//   <span class="emptyNoProject">—</span> (U+2014 EM DASH)
//   cursor: default; clicking does NOTHING (no edit affordance when no project).
//
// Rest state (project assigned):
//   <span class="text" onClick>project_number or muted "—"</span>
//   cursor: text; click enters edit mode.
//
// Edit state: swaps to a controlled <input> filling the cell.
//   Enter or blur → commit (calls projects.updateNumber if changed).
//   Escape → revert draft, exit edit mode.
//
// Key differences from DescriptionCell:
//   1. No usePendingFocusStore — no auto-focus on new row (D-04).
//   2. Renders emptyNoProject "—" (cursor:default, no click) when project_id is null.
//   3. Commit calls projects.updateNumber(timer.project_id, draft.trim() || null).
//   4. useEffect resyncs when timer.project_id or the resolved number changes.
//   5. Resolves project_number client-side from useProjects() cache (D-14).
//
// A-14: uses <input> only — NOT contenteditable.
// A-13: this cell is NOT a tick-store subscriber — only DurationCell subscribes.
//
// Refs:
//   - 05-UI-SPEC.md § ProjectNumberCell (pixel/token/interaction spec)
//   - 05-PATTERNS.md § ProjectNumberCell.tsx (key differences from DescriptionCell)
//   - 05-CONTEXT.md D-04 (dedicated inline-editable Project # column)
//   - 05-CONTEXT.md D-14 (client-side join from useProjects() cache)

import { useEffect, useRef, useState } from 'react'
import styles from './ProjectNumberCell.module.css'
import type { Timer } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useUpdateProjectNumber } from '@/hooks/useUpdateProjectNumber'
import { CopyButton } from '@/components/CopyButton'

interface ProjectNumberCellProps {
  timer: Timer
}

/** Editable Project # cell — blank no-op when no project, swap-to-input when a project is assigned. */
export function ProjectNumberCell({ timer }: ProjectNumberCellProps): JSX.Element {
  const { data: projects } = useProjects()
  const updateNumber = useUpdateProjectNumber()

  // Resolve the current project's number from the cache (D-14 client-side join).
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

  // Focus + select after the <input> is committed to the DOM (WR-03 — queueMicrotask
  // could fire before React commits, leaving inputRef null and the field unfocused).
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
          // focus/select happens in the isEditing useEffect after the input commits (WR-03).
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
