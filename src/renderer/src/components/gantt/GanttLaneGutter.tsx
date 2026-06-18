// GanttLaneGutter: left pane per swim-lane — project combobox above description textarea.
//
// D-14: project combobox (cmdk) + description textarea per lane.
// D-15: lane grows to fit textarea content (textarea auto-resizes via CSS).
//
// Project combobox is cloned from ProjectCell — same cmdk Command root, click-outside,
// create-on-Enter with exact-match dedupe, substring filter (not fuzzy).
//
// Description textarea commits on blur or Ctrl+Enter; Escape reverts.
// Uses useSetDescription hook (same as DescriptionCell) for the IPC mutation.
//
// Refs:
//   - 09-06-PLAN.md Task 1
//   - 09-UI-SPEC.md §"Gantt Canvas Layout", §"Lane Gutter"
//   - 09-PATTERNS.md §"GanttLaneGutter.tsx"

import React, { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import styles from './GanttLaneGutter.module.css'
import type { Timer } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useSetProject } from '@/hooks/useSetProject'
import { useCreateProject } from '@/hooks/useCreateProject'
import { useSetDescription } from '@/hooks/useSetDescription'

interface GanttLaneGutterProps {
  timer: Timer
  /** Notifies the parent lane when the project dropdown opens/closes so it can lift
   *  the lane's stacking order above neighbouring lanes (otherwise the open panel is
   *  painted behind the lane below). */
  onProjectOpenChange?: (open: boolean) => void
}

/** Case-insensitive substring filter for cmdk — NOT fuzzy. */
const substringFilter = (value: string, searchStr: string): number =>
  value.toLowerCase().includes(searchStr.toLowerCase()) ? 1 : 0

/** Lane gutter with project combobox (D-14) and description textarea (D-14/D-15). */
export const GanttLaneGutter = React.memo(function GanttLaneGutter({
  timer,
  onProjectOpenChange,
}: GanttLaneGutterProps): JSX.Element {
  const { data: projects } = useProjects()
  const setProject = useSetProject()
  const createProject = useCreateProject()
  const setDescription = useSetDescription()

  // Project combobox state
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Description textarea state
  const [descDraft, setDescDraft] = useState(timer.description)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Resync draft when upstream description changes while not editing
  useEffect(() => {
    setDescDraft(timer.description)
  }, [timer.description])

  // Let the parent lane raise its stacking order while the dropdown is open.
  useEffect(() => {
    onProjectOpenChange?.(open)
  }, [open, onProjectOpenChange])

  // Auto-size the textarea to its content on mount and whenever the text changes —
  // not only while the user is typing (D-15: lane grows to fit the description).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [descDraft])

  const currentProject = timer.project_id !== null
    ? (projects ?? []).find((p) => p.id === timer.project_id)
    : undefined
  const displayName = currentProject?.project_name ?? null

  // Click-outside close for combobox dropdown — registered only while open
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleSelect = (projectId: number): void => {
    setProject.mutate({ id: timer.id, projectId })
    setOpen(false)
    setSearch('')
  }

  const handleCreate = async (name: string): Promise<void> => {
    // Exact-match dedupe — select existing if name matches exactly
    const existing = (projects ?? []).find(
      (p) => p.project_name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      handleSelect(existing.id)
      return
    }
    const newProject = await createProject.mutateAsync({ name, number: null })
    await setProject.mutateAsync({ id: timer.id, projectId: newProject.id })
    setOpen(false)
    setSearch('')
  }

  const trimmedSearch = search.trim()
  const hasExactMatch = (projects ?? []).some(
    (p) => p.project_name.toLowerCase() === trimmedSearch.toLowerCase(),
  )
  const showCreate = trimmedSearch.length > 0 && !hasExactMatch

  // Description textarea handlers
  const commitDescription = (): void => {
    const trimmed = descDraft.trim()
    if (trimmed !== timer.description) {
      setDescription.mutate({ id: timer.id, description: trimmed })
    }
  }

  return (
    <div className={styles.gutter}>
      {/* Project combobox */}
      <div
        ref={containerRef}
        className={`${styles.projectContainer}${open ? ` ${styles.projectContainerOpen}` : ''}`}
      >
        {!open && (
          <span
            className={styles.projectTrigger}
            onClick={() => {
              setOpen(true)
              setSearch('')
            }}
          >
            {displayName !== null
              ? <span className={styles.displayText}>{displayName}</span>
              : <span className={styles.placeholder}>(no project)</span>}
            <svg
              className={styles.chevron}
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M1 1l4 4 4-4" />
            </svg>
          </span>
        )}

        {open && (
          <Command filter={substringFilter} className={styles.commandRoot}>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search projects…"
              autoFocus
              className={styles.commandInput}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.stopPropagation()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                  setSearch('')
                }
              }}
            />
            <Command.List className={styles.commandList}>
              {(projects ?? []).map((p) => (
                <Command.Item
                  key={p.id}
                  value={p.project_name}
                  className={styles.commandItem}
                  onSelect={() => handleSelect(p.id)}
                >
                  {p.project_name}
                </Command.Item>
              ))}
              {showCreate && (
                <Command.Item
                  key="__create__"
                  value={`create-new-${trimmedSearch}`}
                  className={styles.commandCreateItem}
                  onSelect={() => { void handleCreate(trimmedSearch) }}
                >
                  Create &quot;{trimmedSearch}&quot;
                </Command.Item>
              )}
            </Command.List>
          </Command>
        )}
      </div>

      {/* Description textarea — D-14, grows to fit content (D-15) */}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={descDraft}
        placeholder="(no description)"
        rows={1}
        onChange={(e) => setDescDraft(e.target.value)}
        onBlur={commitDescription}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            commitDescription()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setDescDraft(timer.description)
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
})
