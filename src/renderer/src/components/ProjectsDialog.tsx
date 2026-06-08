// Native <dialog> Projects manager — inline-editable project list (name + number),
// "+ Add project" row, and count-aware delete-with-confirm flow.
//
// Open/close:  Opened imperatively by App via projectsDialogRef.current?.showModal()
//              (same pattern as SettingsDialog). ESC fires native `cancel` → close().
//
// Inline edit: DescriptionCell semantics — click to edit, Enter/blur to commit (IPC
//              only when value changed), Escape to revert without IPC call.
//
// Delete flow: Click trash → fresh countTimerRefs IPC (A-07 gate, never the cache) →
//              open useConfirmDeleteProjectStore → count-aware confirm copy → delete.
//
// Renders entirely in the renderer process — no secondary OS window opened (gate A-06).

import { forwardRef, useEffect, useRef, useState } from 'react'
import styles from './ProjectsDialog.module.css'
import type { Project } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useCreateProject } from '@/hooks/useCreateProject'
import { useUpdateProjectName } from '@/hooks/useUpdateProjectName'
import { useUpdateProjectNumber } from '@/hooks/useUpdateProjectNumber'
import { useDeleteProject } from '@/hooks/useDeleteProject'
import { useConfirmDeleteProjectStore } from '@/stores/useConfirmDeleteProjectStore'

// ---------------------------------------------------------------------------
// ProjectRow — file-local sub-component (not exported)
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  project: Project
  autoFocusField?: 'name' | null
}

function ProjectRow({ project, autoFocusField }: ProjectRowProps): JSX.Element {
  const updateName = useUpdateProjectName()
  const updateNumber = useUpdateProjectNumber()

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.project_name)
  const nameRef = useRef<HTMLInputElement>(null)

  const [isEditingNumber, setIsEditingNumber] = useState(false)
  const [numberDraft, setNumberDraft] = useState(project.project_number ?? '')
  const numberRef = useRef<HTMLInputElement>(null)

  const [nameError, setNameError] = useState<string | null>(null)
  const [numberError, setNumberError] = useState<string | null>(null)

  // Resync drafts when upstream project data changes while not editing
  useEffect(() => {
    if (!isEditingName) setNameDraft(project.project_name)
  }, [project.project_name, isEditingName])

  useEffect(() => {
    if (!isEditingNumber) setNumberDraft(project.project_number ?? '')
  }, [project.project_number, isEditingNumber])

  // Focus + select on edit entry
  useEffect(() => {
    if (isEditingName) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [isEditingName])

  useEffect(() => {
    if (isEditingNumber) {
      numberRef.current?.focus()
      numberRef.current?.select()
    }
  }, [isEditingNumber])

  // Auto-focus the name field on newly created rows
  useEffect(() => {
    if (autoFocusField === 'name') {
      queueMicrotask(() => {
        setIsEditingName(true)
      })
    }
  // Only fire once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commitName = (): void => {
    const trimmed = nameDraft.trim()
    // Revert if empty — name is required
    if (trimmed === '') {
      setNameDraft(project.project_name)
      setIsEditingName(false)
      return
    }
    if (trimmed !== project.project_name) {
      updateName.mutate(
        { id: project.id, name: trimmed },
        {
          onError: () => setNameError('Could not save. Try again.'),
          onSuccess: () => setNameError(null),
        },
      )
    }
    setIsEditingName(false)
  }

  const cancelName = (): void => {
    setNameDraft(project.project_name)
    setIsEditingName(false)
  }

  const commitNumber = (): void => {
    const trimmed = numberDraft.trim()
    const newValue = trimmed === '' ? null : trimmed
    if (newValue !== project.project_number) {
      updateNumber.mutate(
        { id: project.id, number: newValue },
        {
          onError: () => setNumberError('Could not save. Try again.'),
          onSuccess: () => setNumberError(null),
        },
      )
    }
    setIsEditingNumber(false)
  }

  const cancelNumber = (): void => {
    setNumberDraft(project.project_number ?? '')
    setIsEditingNumber(false)
  }

  const handleDeleteClick = async (): Promise<void> => {
    // A-07: always fetch a FRESH count — never the TanStack Query cache
    const count = await window.api.projects.countTimerRefs(project.id)
    useConfirmDeleteProjectStore.getState().open(project.id, project.project_name, count)
  }

  return (
    <div className={styles.row}>
      {/* Name cell */}
      <div className={styles.nameCell}>
        {isEditingName ? (
          <input
            ref={nameRef}
            type="text"
            value={nameDraft}
            placeholder="Project name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') cancelName()
            }}
            className={styles.input}
          />
        ) : (
          <span
            className={styles.nameText}
            onClick={() => setIsEditingName(true)}
          >
            {project.project_name}
          </span>
        )}
        {nameError !== null && (
          <p className={styles.error} role="status" aria-live="polite">
            {nameError}
          </p>
        )}
      </div>

      {/* Number cell */}
      <div className={styles.numberCell}>
        {isEditingNumber ? (
          <input
            ref={numberRef}
            type="text"
            value={numberDraft}
            placeholder="Number"
            onChange={(e) => setNumberDraft(e.target.value)}
            onBlur={commitNumber}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNumber()
              if (e.key === 'Escape') cancelNumber()
            }}
            className={styles.input}
          />
        ) : (
          <span
            className={`${styles.numberText} ${!project.project_number ? styles.numberEmpty : ''}`}
            onClick={() => setIsEditingNumber(true)}
          >
            {project.project_number ?? '—'}
          </span>
        )}
        {numberError !== null && (
          <p className={styles.error} role="status" aria-live="polite">
            {numberError}
          </p>
        )}
      </div>

      {/* Delete control */}
      <button
        type="button"
        className={styles.deleteBtn}
        aria-label={`Delete project "${project.project_name}"`}
        onClick={() => { void handleDeleteClick() }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </svg>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog — nested project-delete confirm driven by store
// ---------------------------------------------------------------------------

function ProjectDeleteConfirmDialog(): JSX.Element {
  const confirmDialogRef = useRef<HTMLDialogElement>(null)
  const pendingDelete = useConfirmDeleteProjectStore((s) => s.pendingDelete)
  const close = useConfirmDeleteProjectStore((s) => s.close)
  const deleteProject = useDeleteProject()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Reactive open/close in response to store state
  useEffect(() => {
    const d = confirmDialogRef.current
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
      await deleteProject.mutateAsync(pendingDelete.id)
      setDeleteError(null)
    } catch {
      setDeleteError('Could not delete. Try again.')
      return
    }
    close()
  }

  // Count-aware body copy
  const getBodyCopy = (): string => {
    if (!pendingDelete) return ''
    const { name, timerCount } = pendingDelete
    if (timerCount === 0) return `Delete "${name}"? This cannot be undone.`
    if (timerCount === 1) return `Delete "${name}"? 1 timer will be unassigned.`
    return `Delete "${name}"? ${timerCount} timers will be unassigned.`
  }

  return (
    <dialog
      ref={confirmDialogRef}
      className={styles.dialog}
      onCancel={handleCancel}
      onClose={handleCancel}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Delete project?</h2>
      </header>
      <div className={styles.body}>
        <p className={styles.copy}>{getBodyCopy()}</p>
        {deleteError !== null && (
          <p className={styles.error} role="status" aria-live="polite">
            {deleteError}
          </p>
        )}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.btn} onClick={handleCancel}>
          Keep project
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={() => { void handleConfirm() }}
        >
          Delete
        </button>
      </footer>
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// ProjectsDialog — main export
// ---------------------------------------------------------------------------

export const ProjectsDialog = forwardRef<HTMLDialogElement>(
  function ProjectsDialog(_, ref): JSX.Element {
    const { data: projects = [] } = useProjects()
    const createProject = useCreateProject()

    // Track the id of the newly created project so its name field auto-focuses
    const [newProjectId, setNewProjectId] = useState<number | null>(null)

    const close = (): void => {
      if (typeof ref === 'object' && ref !== null && ref.current !== null) {
        ref.current.close()
      }
    }

    const handleAddProject = (): void => {
      createProject.mutate(
        { name: 'New project', number: null },
        {
          onSuccess: (created) => {
            setNewProjectId(created.id)
          },
        },
      )
    }

    return (
      <dialog ref={ref} className={styles.dialog} onCancel={close}>
        <header className={styles.header}>
          <h2 className={styles.title}>Projects</h2>
        </header>

        <div className={styles.body}>
          {projects.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyHeading}>No projects yet</p>
              <p className={styles.emptyBody}>Add a project to assign it to your timers.</p>
            </div>
          ) : (
            <div className={styles.list}>
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  autoFocusField={project.id === newProjectId ? 'name' : null}
                />
              ))}
            </div>
          )}

          {/* Add-new row */}
          <button
            type="button"
            className={styles.addRow}
            onClick={handleAddProject}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            + Add project
          </button>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={close}
          >
            Close
          </button>
        </footer>

        {/* Nested project-delete confirm dialog, driven by useConfirmDeleteProjectStore */}
        <ProjectDeleteConfirmDialog />
      </dialog>
    )
  },
)

ProjectsDialog.displayName = 'ProjectsDialog'
