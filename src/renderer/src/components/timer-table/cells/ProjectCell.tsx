// cmdk headless type-ahead combobox for project assignment.
//
// Filter is case-insensitive substring, NOT fuzzy — avoids surprising matches.
// ArrowUp/Down are stopped from propagating to TanStack Table (prevents row nav).
// Click-outside uses a mousedown listener registered only while the dropdown is open.
// Create flow checks for a case-insensitive exact match before creating (deduplication).
// Uses Command root only — never the Dialog variant (which would instantiate Radix Dialog).
// Not a tick-store subscriber.

import React, { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import styles from './ProjectCell.module.css'
import type { Timer } from '@shared/ipc'
import { useProjects } from '@/hooks/useProjects'
import { useSetProject } from '@/hooks/useSetProject'
import { useCreateProject } from '@/hooks/useCreateProject'
import { CopyButton } from '@/components/CopyButton'

interface ProjectCellProps {
  timer: Timer
}

/** Case-insensitive substring filter for cmdk — NOT fuzzy. */
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

  const currentProject = timer.project_id !== null
    ? (projects ?? []).find((p) => p.id === timer.project_id)
    : undefined
  const displayName = currentProject?.project_name ?? null

  // Click-outside close — mousedown listener, registered only while open.
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
    // Exact-match guard — select existing project instead of creating a duplicate.
    const existing = (projects ?? []).find(
      (p) => p.project_name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      handleSelect(existing.id)
      return
    }
    // mutateAsync returns the new Project directly, so selection uses newProject.id
    // (not the cache). useSetProject.onSuccess already invalidates ['timers'].
    const newProject = await createProject.mutateAsync({ name, number: null })
    await setProject.mutateAsync({ id: timer.id, projectId: newProject.id })
    setOpen(false)
    setSearch('')
  }

  // The Create affordance must be reachable even when the search is a substring of an
  // existing project (Command.Empty only renders when ZERO items match). Render it as a
  // real Command.Item so Enter (no exact match) or click creates.
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
      {/* Closed state trigger + copy button (copy shown only when a project is set) */}
      {!open && (
        <span className={styles.cellWrap}>
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
          {displayName !== null && (
            <CopyButton value={displayName} label="Copy project name" />
          )}
        </span>
      )}

      {/* Open state — Command ROOT only (never the Dialog variant) */}
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
              // Prevent TanStack Table row navigation.
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
                // Value embeds the search so substringFilter always keeps this item visible in the list.
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
