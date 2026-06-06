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
// render; while the date-scoped query is pending that fresh `[]` makes TanStack
// Table treat `data` as changed every render, firing its auto-reset setState →
// an infinite re-render loop that starves the IPC. A shared empty array fixes it.
const EMPTY_TIMERS: Timer[] = []
// getRowId as a stable reference for the same reason (per-render identity churn).
const getTimerRowId = (row: Timer): string => String(row.id)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** TanStack Table v8 headless host rendering 6-column timer table. */
export function TimerTable(): JSX.Element {
  const selectedDate = useSelectedDateStore((s) => s.date)
  const { fromEpoch, toEpoch } = dayRangeOf(selectedDate)
  const query = useDayTimers(fromEpoch, toEpoch)
  const data = query.data ?? EMPTY_TIMERS // stable empty ref — never a fresh []

  const table = useReactTable({
    data,
    columns,
    getRowId: getTimerRowId, // row identity survives reorderings; stable ref
    getCoreRowModel: getCoreRowModel(),
  })

  // Persistent percentage column widths (localStorage) + manual resize.
  const { widths, setWidths, persist } = useColumnWidths(COLUMN_ORDER, DEFAULT_WIDTHS)
  const tableRef = useRef<HTMLTableElement>(null)
  // Active-drag scratch state — kept in a ref so pointermove doesn't trigger React re-renders.
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
                  {/* Resize handle on right edge of every column but the last. */}
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
