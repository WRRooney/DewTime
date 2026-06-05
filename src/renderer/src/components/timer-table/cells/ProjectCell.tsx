// src/renderer/src/components/timer-table/cells/ProjectCell.tsx
// cmdk headless type-ahead combobox for project assignment (PROJ-01/02/03).
//
// Closed state: shows the project name from the useProjects() cache (D-14 client-side
// join) or "(no project)" placeholder when project_id is null. A 10×6 chevron SVG
// signals this cell is a dropdown trigger.
//
// Open state: absolutely positioned <Command> panel renders below the trigger with a
// substring filter (`toLowerCase().includes(...)` — PROJ-02, NOT fuzzy — Pitfall 2).
// ArrowUp/Down are stopped from propagating to TanStack Table (prevents row nav).
// Escape closes the dropdown without letting the table consume the key.
// Click-outside (mousedown listener) closes the dropdown.
//
// Select: handleSelect(project.id) → useSetProject.mutate({ id: timer.id, projectId }) → invalidates ['timers'].
// Create (D-12/D-13): handleCreate(name) — checks for exact-match duplicate first
//   (case-insensitive, D-13). If none, calls useCreateProject.mutateAsync → invalidates
//   ['projects'] (done in onSuccess) → then useSetProject.mutateAsync → invalidates ['timers'].
//
// A-17: ONLY `Command` root — never the Dialog variant (would instantiate Radix UI Dialog).
// A-01: CSS Modules + var(--*) tokens only — no hex/HSL/rgb literals.
// A-13: NOT a tick-store subscriber.
//
// Refs:
//   - 05-UI-SPEC.md § ProjectCell (pixel/token/interaction/copy spec)
//   - 05-RESEARCH.md § Pattern 1 (cmdk combobox), § Pattern 2 (focus + click-outside)
//   - 05-CONTEXT.md D-12 (create flow), D-13 (exact-match guard), D-14 (client-side join)
//   - 05-PATTERNS.md § ProjectCell.tsx

import React, { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import styles from './ProjectCell.module.css'
import type { Timer } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useSetProject } from '@/hooks/useSetProject'
import { useCreateProject } from '@/hooks/useCreateProject'

interface ProjectCellProps {
  timer: Timer
}

/** Case-insensitive substring filter for cmdk — PROJ-02, NOT fuzzy (Pitfall 2). */
const substringFilter = (value: string, searchStr: string): number =>
  value.toLowerCase().includes(searchStr.toLowerCase()) ? 1 : 0

/** cmdk type-ahead combobox — project assignment with create-on-Enter and exact-match dedupe. */
const ProjectCell = React.memo(function ProjectCell({ timer }: ProjectCellProps): JSX.Element {
  const { data: projects } = useProjects()
  const setProject = useSetProject()
  const createProject = useCreateProject()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // D-14: resolve current project name from the shared cache (no JOIN).
  const currentProject = timer.project_id !== null
    ? (projects ?? []).find((p) => p.id === timer.project_id)
    : undefined
  const displayName = currentProject?.project_name ?? null

  // Click-outside close (RESEARCH § Pattern 2 — mousedown listener, registered only while open).
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
    // D-13: exact-match guard — select existing project instead of creating duplicate.
    const existing = (projects ?? []).find(
      (p) => p.project_name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      handleSelect(existing.id)
      return
    }
    // D-12: create-then-select flow. mutateAsync returns the new Project directly,
    // so selection uses newProject.id (not the cache). useSetProject.onSuccess already
    // invalidates ['timers'] — no manual re-invalidate needed here (WR-04).
    const newProject = await createProject.mutateAsync({ name, number: null })
    await setProject.mutateAsync({ id: timer.id, projectId: newProject.id })
    setOpen(false)
    setSearch('')
  }

  // WR-05: the Create affordance must be reachable even when the search is a substring
  // of an existing project (Command.Empty only renders when ZERO items match). Render it
  // as a real, always-filterable Command.Item so Enter (no exact match) or click creates.
  const trimmedSearch = search.trim()
  const hasExactMatch = (projects ?? []).some(
    (p) => p.project_name.toLowerCase() === trimmedSearch.toLowerCase(),
  )
  const showCreate = trimmedSearch.length > 0 && !hasExactMatch

  return (
    <div
      ref={containerRef}
      className={`${styles.container}${open ? ` ${styles.containerOpen}` : ''}`}
    >
      {/* Closed state trigger */}
      {!open && (
        <span
          className={styles.trigger}
          data-testid="project-trigger"
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

      {/* Open state — A-17: Command ROOT only (never the Dialog variant) */}
      {open && (
        <Command
          filter={substringFilter}
          className={styles.commandRoot}
        >
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search projects…"
            autoFocus
            className={styles.input}
            onKeyDown={(e) => {
              // Prevent TanStack Table row navigation (RESEARCH § Pattern 2).
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.stopPropagation()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                setSearch('')
              }
            }}
          />
          <Command.List className={styles.list}>
            {(projects ?? []).map((p) => (
              <Command.Item
                key={p.id}
                value={p.project_name}
                className={styles.item}
                onSelect={() => {
                  handleSelect(p.id)
                }}
              >
                {p.project_name}
              </Command.Item>
            ))}
            {showCreate && (
              <Command.Item
                key="__create__"
                // Value embeds the search so substringFilter always keeps this item visible.
                value={`create-new-${trimmedSearch}`}
                className={styles.createItem}
                onSelect={() => {
                  void handleCreate(trimmedSearch)
                }}
              >
                <span className={styles.createButton}>Create &quot;{trimmedSearch}&quot;</span>
              </Command.Item>
            )}
          </Command.List>
        </Command>
      )}
    </div>
  )
})

export { ProjectCell }
