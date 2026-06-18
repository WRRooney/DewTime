// GanttBar: single time-entry bar — the core interactive primitive of the Gantt.
//
// React.memo is MANDATORY: GanttBar subscribes to useTickStore (per-second updates).
// Without memo, every tick would re-render all ancestor components in the tree.
//
// Drag state is stored in useRef<DragState> (not useState) so pointer-move handlers
// do not trigger re-renders during drag. Only the display-position state triggers
// re-renders on meaningful position changes.
//
// D-17: edge-resize commits via setStart / setEnd
// D-18: snap via snapEpoch(value, snapIncrementFor(span), e.altKey); Alt = free-drag
// D-19: running bar — right edge tracks now via useTickStore; right handle omitted from DOM
// D-20: body-move commits via atomic window.api.timeEntries.setTimestamps
// D-23: double-click opens editor window via window.api.editor.open(timer_id)
// D-24: Delete/Backspace and right-click "Delete Entry" route through useConfirmDeleteEntryStore
// D-25: single-click selects bar
// D-28: minimum rendered width 8px (real timestamps unchanged)

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import styles from './GanttBar.module.css'
import type { TimeEntry, Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'
import { useTickStore } from '@/stores/useTickStore'
import { useSetEntryStart, useSetEntryEnd } from '@/hooks/useSetEntryTimestamps'
import { useStopTimer } from '@/hooks/useStopTimer'
import { useConfirmDeleteEntryStore } from '@/stores/useConfirmDeleteEntryStore'
import { timersQueryKey } from '@/hooks/useTimers'
import { entriesNamespaceKey } from '@/hooks/useEntriesForTimer'
import {
  epochToX,
  xToEpoch,
  snapEpoch,
  snapIncrementFor,
  type GanttViewport,
} from '@/utils/gantt-math'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GanttBarProps {
  entry: TimeEntry
  timer: Timer
  viewport: GanttViewport
  color: string
  selected: boolean
  onSelect: (entryId: number) => void
  onDragTooltip: (t: { startEpoch: EpochSeconds; endEpoch: EpochSeconds } | null) => void
}

type DragKind = 'idle' | 'move' | 'resize-start' | 'resize-end'

interface DragState {
  kind: DragKind
  startX: number                  // pointer x at drag start
  origStart: EpochSeconds         // entry start at drag start
  origEnd: EpochSeconds           // entry end at drag start (for running: current tick epoch)
}

interface DisplayPos {
  left: number    // px
  width: number   // px (clamped >= 8)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_BAR_WIDTH = 8   // D-28: minimum rendered width in px

// ---------------------------------------------------------------------------
// Inline body-move mutation (atomic setTimestamps for D-20)
// ---------------------------------------------------------------------------

function useSetEntryBounds() {
  const qc = useQueryClient()
  return useMutation<void, Error, { entryId: number; startTs: EpochSeconds; endTs: EpochSeconds }>({
    mutationFn: ({ entryId, startTs, endTs }) =>
      window.api.timeEntries.setTimestamps(
        entryId,
        Math.round(startTs) as EpochSeconds,
        Math.round(endTs) as EpochSeconds,
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
        qc.invalidateQueries({ queryKey: ['timeEntries', 'gantt'] }),
      ])
    },
  })
}

// ---------------------------------------------------------------------------
// GanttBar component
// ---------------------------------------------------------------------------

export const GanttBar = React.memo(function GanttBar({
  entry,
  timer,
  viewport,
  color,
  selected,
  onSelect,
  onDragTooltip,
}: GanttBarProps): JSX.Element {
  const tick = useTickStore((s) => s.tick)

  const isRunning = entry.end_timestamp === null

  // Compute the "live" end epoch for running bars: uses tick when ticking, else startEpoch+1
  const liveEndEpoch: EpochSeconds = isRunning
    ? tick !== null && tick.timerId === timer.id
      ? (entry.start_timestamp + tick.elapsedSeconds) as EpochSeconds
      : (entry.start_timestamp + 1) as EpochSeconds
    : (entry.end_timestamp as EpochSeconds)

  // Compute base display position from the entry timestamps
  const computePos = useCallback(
    (start: EpochSeconds, end: EpochSeconds): DisplayPos => {
      const rawLeft = epochToX(start, viewport)
      const rawRight = epochToX(end, viewport)
      const rawWidth = rawRight - rawLeft
      const width = Math.max(MIN_BAR_WIDTH, rawWidth)
      return { left: rawLeft, width }
    },
    [viewport],
  )

  const [displayPos, setDisplayPos] = useState<DisplayPos>(() =>
    computePos(entry.start_timestamp, liveEndEpoch),
  )

  // Update display position when entry props or live end changes (outside drag)
  useEffect(() => {
    if (dragRef.current.kind === 'idle') {
      setDisplayPos(computePos(entry.start_timestamp, liveEndEpoch))
    }
  }, [entry.start_timestamp, liveEndEpoch, computePos])

  // Drag state lives in a ref to avoid re-renders on every pointer-move
  const dragRef = useRef<DragState>({
    kind: 'idle',
    startX: 0,
    origStart: entry.start_timestamp,
    origEnd: liveEndEpoch,
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Mutations
  const setEntryStart = useSetEntryStart()
  const setEntryEnd = useSetEntryEnd()
  const setEntryBounds = useSetEntryBounds()
  const stopTimer = useStopTimer()

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [contextMenu])

  // ---------------------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------------------

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, kind: DragKind) => {
    e.stopPropagation()
    // setPointerCapture ensures pointer events continue to fire on this element
    // even when the pointer moves outside the element bounds during drag.
    // Guard: jsdom does not implement this API; the guard is a no-op in production.
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    dragRef.current = {
      kind,
      startX: e.clientX,
      origStart: entry.start_timestamp,
      origEnd: liveEndEpoch,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag.kind === 'idle') return

    const dx = e.clientX - drag.startX
    const epochDelta = (dx / viewport.canvasWidthPx) * viewport.spanSeconds
    const snap = snapIncrementFor(viewport.spanSeconds)

    let newStart = drag.origStart
    let newEnd = drag.origEnd

    if (drag.kind === 'move') {
      newStart = snapEpoch(
        (drag.origStart + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      const duration = drag.origEnd - drag.origStart
      newEnd = (newStart + duration) as EpochSeconds
    } else if (drag.kind === 'resize-start') {
      newStart = snapEpoch(
        (drag.origStart + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      // Don't allow start past end - 1s
      if (newStart >= drag.origEnd) newStart = (drag.origEnd - 1) as EpochSeconds
    } else if (drag.kind === 'resize-end') {
      newEnd = snapEpoch(
        (drag.origEnd + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      // Don't allow end before start + 1s
      if (newEnd <= drag.origStart) newEnd = (drag.origStart + 1) as EpochSeconds
    }

    setDisplayPos(computePos(newStart, newEnd))
    onDragTooltip({ startEpoch: newStart, endEpoch: newEnd })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag.kind === 'idle') return

    const dx = e.clientX - drag.startX
    const epochDelta = (dx / viewport.canvasWidthPx) * viewport.spanSeconds
    const snap = snapIncrementFor(viewport.spanSeconds)

    let newStart = drag.origStart
    let newEnd = drag.origEnd

    if (drag.kind === 'move') {
      newStart = snapEpoch(
        (drag.origStart + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      const duration = drag.origEnd - drag.origStart
      newEnd = (newStart + duration) as EpochSeconds
      // Atomic body-move: setTimestamps (Pitfall 3)
      void setEntryBounds.mutate({ entryId: entry.id, startTs: newStart, endTs: newEnd })
    } else if (drag.kind === 'resize-start') {
      newStart = snapEpoch(
        (drag.origStart + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      if (newStart >= drag.origEnd) newStart = (drag.origEnd - 1) as EpochSeconds
      void setEntryStart.mutate({ entryId: entry.id, ts: newStart })
    } else if (drag.kind === 'resize-end') {
      newEnd = snapEpoch(
        (drag.origEnd + epochDelta) as EpochSeconds,
        snap,
        e.altKey,
      )
      if (newEnd <= drag.origStart) newEnd = (drag.origStart + 1) as EpochSeconds
      void setEntryEnd.mutate({ entryId: entry.id, ts: newEnd })
    }

    dragRef.current = { kind: 'idle', startX: 0, origStart: entry.start_timestamp, origEnd: liveEndEpoch }
    onDragTooltip(null)
  }

  // ---------------------------------------------------------------------------
  // Interaction handlers
  // ---------------------------------------------------------------------------

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(entry.id)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    void window.api.editor.open(entry.timer_id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      useConfirmDeleteEntryStore.getState().open(entry.id, timer.description)
    }
  }

  const handleStopClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    void stopTimer.mutate(timer.id)
  }

  const handleContextOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation()
    setContextMenu(null)
    void window.api.editor.open(entry.timer_id)
  }

  const handleContextDeleteEntry = (e: React.MouseEvent) => {
    e.stopPropagation()
    setContextMenu(null)
    useConfirmDeleteEntryStore.getState().open(entry.id, timer.description)
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const barStyle: React.CSSProperties = {
    left: `${displayPos.left}px`,
    width: `${displayPos.width}px`,
    // Color is passed as a prop; we use CSS custom property for fill
    '--bar-color': color,
  } as React.CSSProperties

  const barClass = [
    styles.bar,
    isRunning ? styles.barRunning : '',
    selected ? styles.barSelected : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div
        data-testid="gantt-bar"
        className={barClass}
        style={barStyle}
        tabIndex={selected ? 0 : -1}
        role="button"
        aria-selected={selected}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerDown={(e) => {
          // Hit-test: body-move if not on a handle
          if ((e.target as Element).closest('[data-handle]')) return
          handlePointerDown(e, 'move')
        }}
      >
        {/* Left edge resize handle — always rendered for both stopped and running bars */}
        <div
          data-testid="edge-handle-start"
          data-handle="start"
          className={styles.edgeHandleStart}
          onPointerDown={(e) => {
            e.stopPropagation()
            handlePointerDown(e, 'resize-start')
          }}
        />

        {/* No in-bar description label — the description lives in the lane gutter. */}

        {/* Stop icon — running bars only (D-13) */}
        {isRunning && (
          <button
            type="button"
            className={styles.stopIcon}
            onClick={handleStopClick}
            aria-label="Stop timer"
          >
            {/* 10×10 filled square SVG per UI-SPEC */}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0" y="0" width="10" height="10" />
            </svg>
          </button>
        )}

        {/* Right edge resize handle — OMITTED for running bars (D-19, Pitfall 2) */}
        {!isRunning && (
          <div
            data-testid="edge-handle-end"
            data-handle="end"
            className={styles.edgeHandleEnd}
            onPointerDown={(e) => {
              e.stopPropagation()
              handlePointerDown(e, 'resize-end')
            }}
          />
        )}
      </div>

      {/* Context menu (portal-free: absolutely positioned relative to viewport) */}
      {contextMenu !== null && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={handleContextOpenEditor}
          >
            Open Editor
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={handleContextDeleteEntry}
          >
            Delete Entry
          </button>
        </div>
      )}
    </>
  )
})
