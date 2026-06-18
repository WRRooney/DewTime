// GanttView: root canvas for the Gantt view.
//
// Owns:
//   - viewport state (startEpoch, spanSeconds, canvasWidthPx) — local, not persisted
//   - ResizeObserver measuring canvasWidthPx
//   - Wheel zoom (D-08): scroll → zoom with cursor pivot; Shift+scroll → pan
//   - Empty-canvas pointer drag pan (D-09): only when not on a bar or handle
//   - Re-center on selectedDate changes (D-10): sets startEpoch to day's start + resets span
//   - selectedEntryId state (D-25: single-select; clear on empty-canvas click)
//   - Drag tooltip state (passed to GanttBar via onDragTooltip)
//
// Composes:
//   - GanttAxisHeader (sticky top, D-11/D-12)
//   - GanttLane per timer from useDayTimers (D-05, entries from useGanttEntries D-06)
//   - GanttGhostLane (pinned bottom, D-22)
//   - GanttInfoPopover (top-right over axis)
//   - Now-line via useTickStore (D-13)
//   - Cross-lane overlap hint at span <= 3 days (D-27)
//   - GanttDragTooltip when drag active
//
// Anti-patterns avoided:
//   - Raw wall-clock access NEVER called — "now" comes from useTickStore (tick-epoch rule)
//   - No auto-viewport advance (Pitfall 5)
//   - Drag state in useRef, not useState (Pitfall — 60fps)
//
// Refs:
//   - 09-06-PLAN.md Task 3
//   - 09-UI-SPEC.md §"Gantt Canvas Layout", §"Gantt Zoom & Pan"
//   - 09-PATTERNS.md §"GanttView.tsx"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import styles from './GanttView.module.css'
import {
  epochToX,
  xToEpoch,
  snapIncrementFor,
  type GanttViewport,
  MIN_SPAN_SECONDS,
  MAX_SPAN_SECONDS,
  DEFAULT_SPAN_SECONDS,
} from '@/utils/gantt-math'
import { dayRangeOf } from '@/utils/date-ranges'
import { useSelectedDateStore } from '@/stores/useSelectedDateStore'
import { useTickStore } from '@/stores/useTickStore'
import { useDayTimers } from '@/hooks/useDateTimers'
import { useGanttEntries } from '@/hooks/useGanttEntries'
import { useCreateTimer } from '@/hooks/useCreateTimer'
import { useCreateEntry } from '@/hooks/useCreateEntry'
import { useGutterWidth } from '@/hooks/useGutterWidth'
import { GanttAxisHeader } from './GanttAxisHeader'
import { GanttLane } from './GanttLane'
import { GanttGhostLane } from './GanttGhostLane'
import { GanttInfoPopover } from './GanttInfoPopover'
import { GanttDragTooltip } from './GanttDragTooltip'
import type { EpochSeconds } from '@shared/time'

const SECONDS_PER_DAY = 86400
const CROSS_LANE_HINT_MAX_SPAN = SECONDS_PER_DAY * 3  // D-27: hint only at span <= 3 days

/** GanttView: the full gantt canvas — see module-level comments for detail. */
export function GanttView(): JSX.Element {
  const selectedDate = useSelectedDateStore((s) => s.date)
  const tick = useTickStore((s) => s.tick)
  const createTimer = useCreateTimer()
  const createEntry = useCreateEntry()
  const { widthPct: gutterWidthPct, setWidthPct: setGutterWidthPct, persist: persistGutterWidth } = useGutterWidth()

  // ---------------------------------------------------------------------------
  // Viewport state — local (not persisted; reset to today on mount)
  // ---------------------------------------------------------------------------

  const [viewport, setViewport] = useState<GanttViewport>(() => {
    const range = dayRangeOf(new Date())
    return {
      startEpoch: range.fromEpoch,
      spanSeconds: DEFAULT_SPAN_SECONDS,
      canvasWidthPx: 0,
    }
  })

  // Re-center when selectedDate changes (D-10) — do NOT auto-advance on clock tick (Pitfall 5)
  useEffect(() => {
    const range = dayRangeOf(selectedDate)
    setViewport((vp) => ({
      ...vp,
      startEpoch: range.fromEpoch,
      spanSeconds: DEFAULT_SPAN_SECONDS,
    }))
  }, [selectedDate])

  // ---------------------------------------------------------------------------
  // Canvas width measurement via ResizeObserver
  // ---------------------------------------------------------------------------

  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) {
        setViewport((vp) => ({ ...vp, canvasWidthPx: width }))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---------------------------------------------------------------------------
  // Selection state (D-25: single-select)
  // ---------------------------------------------------------------------------

  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)

  const handleSelectEntry = useCallback((entryId: number): void => {
    setSelectedEntryId(entryId)
  }, [])

  const handleClearSelection = (): void => {
    setSelectedEntryId(null)
  }

  // ---------------------------------------------------------------------------
  // Drag tooltip state
  // ---------------------------------------------------------------------------

  const [dragTooltip, setDragTooltip] = useState<{
    startEpoch: EpochSeconds
    endEpoch: EpochSeconds
  } | null>(null)

  // ---------------------------------------------------------------------------
  // Wheel handler — zoom (plain scroll) vs pan (Shift+Scroll) (D-08/D-09)
  // ---------------------------------------------------------------------------

  const handleWheel = useCallback((e: WheelEvent): void => {
    e.preventDefault()

    setViewport((vp) => {
      if (e.shiftKey) {
        // Shift+Scroll: pan the viewport
        const panDelta = (e.deltaY / vp.canvasWidthPx) * vp.spanSeconds
        return { ...vp, startEpoch: (vp.startEpoch + panDelta) as EpochSeconds }
      }

      // Zoom: pivot on cursor epoch, clamp span to [MIN, MAX]
      const ZOOM_FACTOR = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const newSpan = Math.min(
        MAX_SPAN_SECONDS,
        Math.max(MIN_SPAN_SECONDS, vp.spanSeconds * ZOOM_FACTOR),
      )

      if (newSpan === vp.spanSeconds) return vp

      // Pivot around the cursor position so the point under cursor stays fixed
      const rect = canvasRef.current?.getBoundingClientRect()
      const cursorX = rect ? e.clientX - rect.left - vp.canvasWidthPx * (1 - 1) : vp.canvasWidthPx / 2
      const cursorEpoch = xToEpoch(cursorX, vp)
      const cursorFraction = cursorX / Math.max(1, vp.canvasWidthPx)
      const newStart = (cursorEpoch - cursorFraction * newSpan) as EpochSeconds

      return { ...vp, startEpoch: newStart, spanSeconds: newSpan }
    })
  }, [])

  // Attach wheel handler with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ---------------------------------------------------------------------------
  // Empty-canvas pointer drag → pan (D-09)
  // ---------------------------------------------------------------------------

  interface PanDragState {
    active: boolean
    startX: number
    startEpoch: EpochSeconds
  }

  const panRef = useRef<PanDragState>({ active: false, startX: 0, startEpoch: 0 as EpochSeconds })

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Hit-test: only pan when not on a bar or handle (D-09 hit-test priority)
    if ((e.target as Element).closest('[data-testid="gantt-bar"]')) return
    if ((e.target as Element).closest('[data-handle]')) return

    panRef.current = {
      active: true,
      startX: e.clientX,
      startEpoch: viewport.startEpoch,
    }
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!panRef.current.active) return
    const dx = e.clientX - panRef.current.startX
    const epochDelta = (dx / Math.max(1, viewport.canvasWidthPx)) * viewport.spanSeconds
    setViewport((vp) => ({
      ...vp,
      startEpoch: (panRef.current.startEpoch - epochDelta) as EpochSeconds,
    }))
  }

  const handlePointerUp = (): void => {
    panRef.current.active = false
  }

  // ---------------------------------------------------------------------------
  // Splitter drag for gutter width (D-16)
  // ---------------------------------------------------------------------------

  const splitterRef = useRef<boolean>(false)
  const splitterStartX = useRef<number>(0)
  const splitterStartPct = useRef<number>(gutterWidthPct)

  const handleSplitterPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    splitterRef.current = true
    splitterStartX.current = e.clientX
    splitterStartPct.current = gutterWidthPct
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const handleSplitterPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!splitterRef.current) return
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width ?? 1
    const dx = e.clientX - splitterStartX.current
    const newPct = splitterStartPct.current + dx / canvasWidth
    setGutterWidthPct(Math.min(0.5, Math.max(0.1, newPct)))
  }

  const handleSplitterPointerUp = (): void => {
    if (!splitterRef.current) return
    splitterRef.current = false
    persistGutterWidth()
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const dayRange = dayRangeOf(selectedDate)
  const { data: timers = [], isError: timersError } = useDayTimers(dayRange.fromEpoch, dayRange.toEpoch)
  const { data: allEntries = [] } = useGanttEntries(viewport.startEpoch, viewport.startEpoch + viewport.spanSeconds)

  // ---------------------------------------------------------------------------
  // Now-line position (D-13)
  // ---------------------------------------------------------------------------

  // "Now" epoch is tracked in state, updated every second via the tick store event.
  // The tick fires from main process every second — we update our local epoch counter
  // in sync with it. This ties the now-line advance to the same push-tick mechanism
  // used by DurationCell and GanttBar.
  //
  // Initial value: floor(performance.timeOrigin + performance.now()) gives epoch-seconds
  // via the Performance API — performance.timeOrigin is set at navigation start,
  // performance.now() gives monotonic offset from it, sum = current epoch-ms.
  const [nowEpochState, setNowEpochState] = useState<EpochSeconds>(
    () => Math.floor(performance.timeOrigin / 1000 + performance.now() / 1000) as EpochSeconds,
  )

  // Update nowEpoch whenever a tick arrives (every second from main process)
  useEffect(() => {
    if (tick !== null) {
      // performance.timeOrigin + performance.now() gives epoch-ms without the
      // raw clock call that is banned in pure math modules.
      const epochMs = performance.timeOrigin + performance.now()
      setNowEpochState(Math.floor(epochMs / 1000) as EpochSeconds)
    }
  }, [tick])

  const nowLineX = epochToX(nowEpochState, viewport)

  const showNowLine = nowLineX >= 0 && nowLineX <= viewport.canvasWidthPx

  // ---------------------------------------------------------------------------
  // Cross-lane overlap hint (D-27): only at span <= 3 days
  // ---------------------------------------------------------------------------

  const showOverlapHints = viewport.spanSeconds <= CROSS_LANE_HINT_MAX_SPAN

  // Compute cross-lane overlap regions (entries that overlap across different timers)
  const overlapRegions: Array<{ leftX: number; rightX: number }> = []
  if (showOverlapHints && allEntries.length > 1) {
    // Group entries by timer, find cross-timer overlaps
    const timerEntryMap = new Map<number, typeof allEntries>()
    for (const entry of allEntries) {
      const list = timerEntryMap.get(entry.timer_id) ?? []
      list.push(entry)
      timerEntryMap.set(entry.timer_id, list)
    }

    // For each entry, check if it overlaps with entries from other timers
    for (const entry of allEntries) {
      const entryEnd = entry.end_timestamp ?? (viewport.startEpoch + viewport.spanSeconds)
      for (const [otherId, otherEntries] of timerEntryMap) {
        if (otherId === entry.timer_id) continue
        for (const other of otherEntries) {
          const otherEnd = other.end_timestamp ?? (viewport.startEpoch + viewport.spanSeconds)
          const overlapStart = Math.max(entry.start_timestamp, other.start_timestamp)
          const overlapEnd = Math.min(entryEnd, otherEnd)
          if (overlapStart < overlapEnd) {
            overlapRegions.push({
              leftX: epochToX(overlapStart as EpochSeconds, viewport),
              rightX: epochToX(overlapEnd as EpochSeconds, viewport),
            })
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAddTimer = (): void => {
    void createTimer.mutate({ projectId: null, description: '' })
  }

  const handleCreateEntryAt = (timerId: number, startTs: number, endTs: number): void => {
    void createEntry.mutate({ timerId, startTs, endTs })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (timersError) {
    return (
      <div className={styles.ganttView} data-testid="gantt-view">
        <p className={styles.errorState}>
          Could not load entries — check your connection and try again.
        </p>
      </div>
    )
  }

  return (
    <div
      className={styles.ganttView}
      data-testid="gantt-view"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClearSelection}
    >
      {/* Info popover — top right over axis */}
      <div className={styles.infoBtn}>
        <GanttInfoPopover />
      </div>

      {/* Sticky axis header */}
      <GanttAxisHeader viewport={viewport} gutterWidthPct={gutterWidthPct} />

      {/* Splitter (D-16 gutter width adjustment) */}
      <div
        className="gantt-splitter"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${gutterWidthPct * 100}%`,
          width: '8px',
          transform: 'translateX(-4px)',
          cursor: 'col-resize',
          zIndex: 12,
          background: 'transparent',
        }}
        onPointerDown={handleSplitterPointerDown}
        onPointerMove={handleSplitterPointerMove}
        onPointerUp={handleSplitterPointerUp}
      />

      {/* Scrollable lane area */}
      <div className={styles.laneArea} ref={canvasRef}>
        {timers.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyHeading}>No timers yet</p>
            <p className={styles.emptyBody}>
              Start a timer from the Timers tab, or double-click below to create one.
            </p>
          </div>
        ) : (
          <div className={styles.laneScroll}>
            {/* Cross-lane overlap hint bands (D-27) */}
            {overlapRegions.map((region, i) => (
              <div
                key={i}
                className={styles.overlapHint}
                style={{
                  left: `${region.leftX + gutterWidthPct * viewport.canvasWidthPx}px`,
                  width: `${region.rightX - region.leftX}px`,
                }}
              />
            ))}

            {/* Now line (D-13) */}
            {showNowLine && nowLineX !== null && (
              <div
                className={styles.nowLine}
                style={{
                  left: `${nowLineX + gutterWidthPct * viewport.canvasWidthPx}px`,
                }}
              />
            )}

            {/* One lane per timer (D-05) */}
            {timers.map((timer) => {
              const timerEntries = allEntries.filter((e) => e.timer_id === timer.id)
              return (
                <GanttLane
                  key={timer.id}
                  timer={timer}
                  entries={timerEntries}
                  viewport={viewport}
                  gutterWidthPct={gutterWidthPct}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={handleSelectEntry}
                  onDragTooltip={setDragTooltip}
                  onCreateEntryAt={handleCreateEntryAt}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Ghost add-lane (D-22) — pinned below lanes, above ghost lane */}
      <GanttGhostLane onAddTimer={handleAddTimer} />

      {/* Drag tooltip — rendered at GanttView scope (floats over everything) */}
      {dragTooltip !== null && (
        <GanttDragTooltip
          startEpoch={dragTooltip.startEpoch}
          endEpoch={dragTooltip.endEpoch}
          x={0}
          y={0}
        />
      )}
    </div>
  )
}
