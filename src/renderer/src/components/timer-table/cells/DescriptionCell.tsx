// src/renderer/src/components/timer-table/cells/DescriptionCell.tsx
// Swap-to-input editable cell for a timer's description (D-25 / FIELD-01).
//
// Rest state: renders a <span> showing `timer.description` (or a muted
// "(no description)" placeholder when empty). Clicking any part of the cell
// enters edit mode (setIsEditing(true)).
//
// Edit state: swaps to a controlled <input> filling the cell. Commits on Enter
// or blur (trimmed value ≠ original → useSetDescription.mutate). Escape reverts
// draft and exits edit mode without any IPC call.
//
// Auto-focus on new row (D-23): mount effect reads usePendingFocusStore; if
// pendingFocusId === timer.id the cell self-activates and focuses the input via
// queueMicrotask (RESEARCH § Pitfall 8 — defer so React commits the input DOM
// before the focus call fires).
//
// A-14 gate: uses <input> controlled element only — NOT the attribute that is forbidden.
// A-13: this cell is NOT a tick-store subscriber — only DurationCell subscribes.
//
// Refs:
//   - 04-CONTEXT.md D-25 (swap-to-input; Enter/blur commit; Escape revert)
//   - 04-CONTEXT.md D-23 (auto-focus via pendingFocusId Zustand slice)
//   - 04-UI-SPEC.md § DescriptionCell (pixel/token/copy spec)
//   - 04-RESEARCH.md § Pattern 5 lines 710-781 (canonical DescriptionCell template)
//   - 04-RESEARCH.md § Pitfall 8 (queueMicrotask defer for pending focus)
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

import { useEffect, useRef, useState } from 'react'
import styles from './DescriptionCell.module.css'
import type { Timer } from '@shared/ipc'
import { useSetDescription } from '@/hooks/useSetDescription'
import { usePendingFocusStore } from '@/stores/usePendingFocusStore'
import { CopyButton } from '@/components/CopyButton'

interface DescriptionCellProps {
  timer: Timer
}

/** Editable description cell — click to edit, Enter/blur to commit, Escape to revert (D-25). */
export function DescriptionCell({ timer }: DescriptionCellProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(timer.description)
  const inputRef = useRef<HTMLInputElement>(null)
  const setDescription = useSetDescription()

  // D-23 — auto-focus on the newly-added row.
  // Read primitive selectors to avoid object-returning selector re-render trap
  // (RESEARCH § Pitfall 2). Zustand returns stable refs for store actions.
  const pendingFocusId = usePendingFocusStore((s) => s.pendingFocusId)
  const clearPendingFocus = usePendingFocusStore((s) => s.clear)

  useEffect(() => {
    if (pendingFocusId === timer.id) {
      setIsEditing(true)
      // queueMicrotask defer: setIsEditing is async — the input doesn't exist in
      // the DOM yet. Defer the focus call to the next microtask so React commits
      // the input element before we try to focus it (RESEARCH § Pitfall 8).
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
        clearPendingFocus()
      })
    }
  }, [pendingFocusId, timer.id, clearPendingFocus])

  // Resync local draft when upstream description changes while cell is at rest.
  // TanStack Table editable-data pattern (RESEARCH § Pattern 5).
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
        data-testid="description-input"
        // autoFocus is intentionally omitted here — the pendingFocusId path uses
        // queueMicrotask + inputRef.focus() instead; direct click uses the same
        // inputRef.focus() path via a separate useEffect when isEditing flips.
      />
    )
  }

  return (
    <span className={styles.cellWrap}>
      {/* Copy sits on the LEFT since the description text is right-aligned. */}
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
