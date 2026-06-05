// src/renderer/src/components/timer-table/TimerTable.tsx
// TanStack Table v8 headless host for the Phase 5 timer table (D-01).
//
// Column order (left → right):
//   Project # | Project | Description | Duration | Start/Stop | Delete
//   (Project # leads with the single "PROJECT" header; project-name header is
//   empty so the pair reads as one PROJECT group. Columns are percentage-width
//   and user-resizable — widths persist to localStorage via useColumnWidths.)
//
// Row identity: `getRowId: (row) => String(row.id)` so React reconciliation
// survives reorderings (e.g. after a new-row insert reshuffles ORDER BY created_at DESC) — D-05.
//
// D-02: NO virtualisation — plain <tbody> map. Revisit only if row counts > 500.
//
// Phase 6 (06-03): switched to useDayTimers(fromEpoch, toEpoch)
// via useSelectedDateStore + dayRangeOf — table now reflects the selected day only.
// This component does NOT subscribe to the tick store — only DurationCell does (A-13).
//
// Empty state: renders a single colSpan=6 row with the Copywriting Contract text
//   "No timers yet. Click + Add Timer to create one."
// Error state: renders a single colSpan=6 row with
//   "Could not load timers. Try again." in --color-danger.
// Loading state: empty <tbody> — IPC is < 5 ms; a skeleton would flash (UI-SPEC).
//
// Refs:
//   - 04-CONTEXT.md D-01 (TanStack Table v8 headless API)
//   - 04-CONTEXT.md D-02 (no virtualisation)
//   - 05-UI-SPEC.md § Column reconciliation D-05 (6-column order)
//   - 04-CONTEXT.md D-05 (getRowId row identity)
//   - 04-RESEARCH.md § Pitfall 7 (colSpan 7->6)
//   - D-27: plain React + CSS Modules; no Radix/shadcn/Tailwind

import { useRef } from 'react'
import {
  createColumnHelper,
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table'
import styles from './TimerTable.module.css'
import type { Timer } from '@shared/ipc'
import { useDayTimers } from '@/hooks/useDateTimers'
import { useSelectedDateStore } from '@/stores/useSelectedDateStore'
import { dayRangeOf } from '@/utils/date-ranges'
import { useColumnWidths, MIN_COLUMN_PCT } from '@/hooks/useColumnWidths'
import { StartStopCell } from './cells/StartStopCell'
import { ProjectNumberCell } from './cells/ProjectNumberCell'
import { ProjectCell } from './cells/ProjectCell'
import { DescriptionCell } from './cells/DescriptionCell'
import { DurationCell } from './cells/DurationCell'
import { DeleteCell } from './cells/DeleteCell'

// ---------------------------------------------------------------------------
// Column definitions (module-level — never re-created on render)
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<Timer>()

// Column order (left → right). Project # leads, immediately followed by the
// project name; "PROJECT" is the only header over the pair (project name has an
// empty header so the two read as one PROJECT group). Action pill + delete sit
// on the right edge (Ignition v0 row layout).
//   Project # | Project | Description | Duration | Start/Stop | Delete
const columns = [
  columnHelper.display({
    id: 'projectNumber',
    header: 'PROJECT',
    cell: ({ row }) => <ProjectNumberCell timer={row.original} />,
  }),
  columnHelper.display({
    id: 'project',
    header: '',
    cell: ({ row }) => <ProjectCell timer={row.original} />,
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    cell: ({ row }) => <DescriptionCell timer={row.original} />,
  }),
  columnHelper.display({
    id: 'duration',
    header: 'Duration',
    cell: ({ row }) => <DurationCell timer={row.original} />,
  }),
  columnHelper.display({
    id: 'startStop',
    header: '',
    cell: ({ row }) => <StartStopCell timer={row.original} />,
  }),
  columnHelper.display({
    id: 'delete',
    header: '',
    cell: ({ row }) => <DeleteCell timer={row.original} />,
  }),
]

// Column IDs that should receive center alignment (icon + numeric columns)
const centerColumns = new Set(['startStop', 'duration', 'delete'])

// Stable left → right id order + default percentage widths (sum = 100).
// Used by useColumnWidths for the persistent <colgroup>.
const COLUMN_ORDER = ['projectNumber', 'project', 'description', 'duration', 'startStop', 'delete']
const DEFAULT_WIDTHS: Record<string, number> = {
  projectNumber: 14,
  project: 20,
  description: 28,
  duration: 16,
  startStop: 13,
  delete: 9,
}

// STABLE module-level references — MUST NOT be recreated per render.
// `query.data ?? []` with an inline `[]` returns a new array identity every
// render; while the date-scoped query is pending (data undefined, e.g. right
// after a prev/next/calendar date change) that fresh `[]` makes TanStack Table
// treat `data` as changed every render, firing its auto-reset setState → an
// infinite re-render loop that pegs the thread and starves the IPC that would
// have populated the data (the date-nav freeze). A shared empty array fixes it.
const EMPTY_TIMERS: Timer[] = []
// getRowId as a stable reference for the same reason (per-render identity churn).
const getTimerRowId = (row: Timer): string => String(row.id)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** TanStack Table v8 headless host rendering 6-column timer table (D-01, D-05). */
export function TimerTable(): JSX.Element {
  const selectedDate = useSelectedDateStore((s) => s.date)
  const { fromEpoch, toEpoch } = dayRangeOf(selectedDate)
  const query = useDayTimers(fromEpoch, toEpoch)
  const data = query.data ?? EMPTY_TIMERS // stable empty ref — never a fresh [] (see EMPTY_TIMERS note)

  const table = useReactTable({
    data,
    columns,
    getRowId: getTimerRowId, // D-05 — row identity survives reorderings; stable ref
    getCoreRowModel: getCoreRowModel(),
  })

  // Persistent percentage column widths (localStorage) + manual resize.
  const { widths, setWidths, persist } = useColumnWidths(COLUMN_ORDER, DEFAULT_WIDTHS)
  const tableRef = useRef<HTMLTableElement>(null)
  // Active-drag scratch state — kept in a ref so pointermove doesn't churn React state.
  const dragRef = useRef<{
    leftId: string
    rightId: string
    startX: number
    startLeft: number
    startRight: number
    tableWidth: number
    next: Record<string, number>
  } | null>(null)

  // Begin resizing the boundary between column `leftId` and the next column.
  const startResize = (leftId: string, e: React.PointerEvent): void => {
    const idx = COLUMN_ORDER.indexOf(leftId)
    const rightId = COLUMN_ORDER[idx + 1]
    if (rightId === undefined) return // last column has no right-edge handle
    const tableWidth = tableRef.current?.getBoundingClientRect().width ?? 0
    if (tableWidth <= 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      leftId,
      rightId,
      startX: e.clientX,
      startLeft: widths[leftId] ?? 0,
      startRight: widths[rightId] ?? 0,
      tableWidth,
      next: { ...widths },
    }
  }

  const onResizeMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (d === null) return
    const deltaPct = ((e.clientX - d.startX) / d.tableWidth) * 100
    const pair = d.startLeft + d.startRight
    // Clamp so neither column in the pair drops below the minimum.
    const newLeft = Math.max(MIN_COLUMN_PCT, Math.min(d.startLeft + deltaPct, pair - MIN_COLUMN_PCT))
    const newRight = pair - newLeft
    const next = { ...d.next, [d.leftId]: newLeft, [d.rightId]: newRight }
    d.next = next
    setWidths(next) // live preview; not persisted until pointerup
  }

  const endResize = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (d === null) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    persist(d.next) // write the final widths to localStorage
  }

  return (
    <table ref={tableRef} className={styles.table} data-testid="timer-table">
      <colgroup>
        {COLUMN_ORDER.map((id) => (
          <col key={id} style={{ width: `${widths[id] ?? DEFAULT_WIDTHS[id]}%` }} />
        ))}
      </colgroup>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header, i) => {
              const isLast = i === headerGroup.headers.length - 1
              return (
                <th
                  key={header.id}
                  className={`${styles.th}${centerColumns.has(header.id) ? ` ${styles.center}` : ''}`}
                >
                  {header.isPlaceholder ? null : (
                    <span className={styles.thLabel}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                  )}
                  {/* Resize handle on the right edge of every column but the last. */}
                  {!isLast && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize column"
                      className={styles.resizeHandle}
                      onPointerDown={(e) => startResize(header.column.id, e)}
                      onPointerMove={onResizeMove}
                      onPointerUp={endResize}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </th>
              )
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {query.isError ? (
          <tr>
            <td colSpan={6} className={styles.error}>
              Could not load timers. Try again.
            </td>
          </tr>
        ) : data.length === 0 && !query.isLoading ? (
          <tr>
            <td colSpan={6} className={styles.empty}>
              No timers yet. Click + Add Timer to create one.
            </td>
          </tr>
        ) : (
          table.getRowModel().rows.map((row) => (
            <tr key={row.id} data-testid="timer-row">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={centerColumns.has(cell.column.id) ? styles.tdCenter : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
