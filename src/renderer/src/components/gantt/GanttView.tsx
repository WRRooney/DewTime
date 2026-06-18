// GanttView: root canvas for the Gantt (Timeline) view.
//
// Owns:
//   - viewport state (startEpoch, spanSeconds, canvasWidthPx) via useGanttViewportStore
//     so zoom/pan SURVIVE tab switches (GanttView unmounts when another tab is active)
//   - ResizeObserver measuring canvasWidthPx
//   - Wheel zoom/pan — ONLY when the pointer is over the time axis (D-08); over the
//     lanes the wheel scrolls the timer list natively
//   - Empty-track pointer drag pan (D-09) with a movement threshold so taps/double-clicks
//     are never captured
//   - Re-center on selectedDate change (D-10) — only when the day actually changes
//   - selectedEntryId state (D-25)
//   - Drag tooltip state
//
// Coordinate model: bars, ticks, and the now-line are positioned against the TRACK
// width (canvas width minus the gutter), not the full lane-area width — otherwise the
// right portion of the timeline overflows the narrower track and becomes unclickable.
//
// Refs:
//   - 09-06-PLAN.md Task 3
//   - 09-UI-SPEC.md §"Gantt Canvas Layout", §"Gantt Zoom & Pan"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import styles from './GanttView.module.css'
import {
  epochToX,
  xToEpoch,
  type GanttViewport,
  MIN_SPAN_SECONDS,
  MAX_SPAN_SECONDS,
} from '@/utils/gantt-math'
import { dayRangeOf } from '@/utils/date-ranges'
import { useSelectedDateStore } from '@/stores/useSelectedDateStore'
import { useTickStore } from '@/stores/useTickStore'
import { useDayTimers } from '@/hooks/useDateTimers'
import { useGanttEntries } from '@/hooks/useGanttEntries'
import { useCreateTimer } from '@/hooks/useCreateTimer'
import { useCreateEntry } from '@/hooks/useCreateEntry'
import { useGutterWidth } from '@/hooks/useGutterWidth'
import { useGanttViewportStore } from '@/stores/useGanttViewportStore'
import { GanttAxisHeader } from './GanttAxisHeader'
import { GanttLane } from './GanttLane'
import { GanttGhostLane } from './GanttGhostLane'
import { GanttInfoPopover } from './GanttInfoPopover'
import { GanttDragTooltip } from './GanttDragTooltip'
import type { EpochSeconds } from '@shared/time'

const SECONDS_PER_DAY = 86400
const CROSS_LANE_HINT_MAX_SPAN = SECONDS_PER_DAY * 3 // D-27: hint only at span <= 3 days
const PAN_THRESHOLD_PX = 4 // movement before a press becomes a pan (taps stay taps)
const ZOOM_STEP = 1.15

/** Local YYYY-MM-DD key for a Date — used to detect day changes for re-centering. */
function dateKeyOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Current epoch-seconds via the Performance API (no banned raw wall-clock read). */
function nowEpochSeconds(): number {
  return Math.floor(performance.timeOrigin / 1000 + performance.now() / 1000)
}

/**
 * Compute a viewport {startEpoch, spanSeconds} that frames all the given entries with
 * ~5% padding on each side, clamped to the [MIN, MAX] span and centered on the content.
 * Returns null when there are no entries (caller falls back to the default day view).
 * Running entries (end = null) extend to "now".
 */
export function computeFitViewport(
  entries: Array<{ start_timestamp: number; end_timestamp: number | null }>,
  nowEpoch: number,
): { startEpoch: number; spanSeconds: number } | null {
  if (entries.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const e of entries) {
    min = Math.min(min, e.start_timestamp)
    max = Math.max(max, e.end_timestamp ?? nowEpoch)
  }
  if (max <= min) max = min + MIN_SPAN_SECONDS // single instant / zero-length safety
  const raw = max - min
  const pad = Math.max(raw * 0.05, 300) // 5% or at least 5 minutes
  const span = Math.min(MAX_SPAN_SECONDS, Math.max(MIN_SPAN_SECONDS, raw + pad * 2))
  const mid = (min + max) / 2
  return { startEpoch: mid - span / 2, spanSeconds: span }
}

/** GanttView: the full gantt canvas — see module-level comments for detail. */
export function GanttView(): JSX.Element {
  const selectedDate = useSelectedDateStore((s) => s.date)
  const tick = useTickStore((s) => s.tick)
  const createTimer = useCreateTimer()
  const createEntry = useCreateEntry()
  const { widthPct: gutterWidthPct, setWidthPct: setGutterWidthPct, persist: persistGutterWidth } = useGutterWidth()

  // ---------------------------------------------------------------------------
  // Viewport — store-backed so zoom/pan persist across tab switches
  // ---------------------------------------------------------------------------

  const startEpoch = useGanttViewportStore((s) => s.startEpoch)
  const spanSeconds = useGanttViewportStore((s) => s.spanSeconds)
  const canvasWidthPx = useGanttViewportStore((s) => s.canvasWidthPx)
  const setCanvasWidth = useGanttViewportStore((s) => s.setCanvasWidth)

  // Track-width viewport: the actual bar/tick rendering area (canvas minus gutter).
  const trackWidthPx = Math.max(0, canvasWidthPx * (1 - gutterWidthPct))
  const trackViewport: GanttViewport = {
    startEpoch: startEpoch as EpochSeconds,
    spanSeconds,
    canvasWidthPx: trackWidthPx,
  }
  const gutterPx = gutterWidthPct * canvasWidthPx

  // Gutter fraction available to imperative pan handler without re-subscribing.
  const gutterRef = useRef(gutterWidthPct)
  gutterRef.current = gutterWidthPct

  // Selected-day entries — used to auto zoom-to-fit on day change and to power the
  // manual zoom-to-fit button.
  const dayRange = dayRangeOf(selectedDate)
  const dayEntriesQuery = useGanttEntries(dayRange.fromEpoch, dayRange.toEpoch)
  const dayEntries = dayEntriesQuery.data ?? []

  // On day change, auto zoom-to-fit that day's entries (empty day → default day view).
  // Runs once per day (guarded by lastDateKey) and only after the day's entries have
  // loaded, so it does NOT fire on remount — switching tabs preserves the current view.
  useEffect(() => {
    const key = dateKeyOf(selectedDate)
    const store = useGanttViewportStore.getState()
    if (store.lastDateKey === key) return
    if (!dayEntriesQuery.isFetched) return
    const fit = computeFitViewport(dayEntries, nowEpochSeconds())
    if (fit) {
      store.setZoom(fit.startEpoch, fit.spanSeconds)
      useGanttViewportStore.setState({ lastDateKey: key })
    } else {
      store.recenter(dayRange.fromEpoch, key)
    }
  }, [selectedDate, dayEntries, dayEntriesQuery.isFetched, dayRange.fromEpoch])

  // Manual zoom-to-fit: frame the selected day's entries.
  const handleZoomToFit = (): void => {
    const fit = computeFitViewport(dayEntries, nowEpochSeconds())
    if (fit) useGanttViewportStore.getState().setZoom(fit.startEpoch, fit.spanSeconds)
  }

  // ---------------------------------------------------------------------------
  // Refs + canvas width measurement
  // ---------------------------------------------------------------------------

  const canvasRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setCanvasWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setCanvasWidth])

  // ---------------------------------------------------------------------------
  // Selection (D-25)
  // ---------------------------------------------------------------------------

  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)
  const [selectedLaneId, setSelectedLaneId] = useState<number | null>(null)
  const handleSelectEntry = useCallback((entryId: number): void => {
    setSelectedEntryId(entryId)
    setSelectedLaneId(null) // a bar selection supersedes a blank-space lane selection
  }, [])
  // Clicking blank space in a lane selects that lane (highlight) and clears bar selection.
  const handleSelectLane = useCallback((timerId: number): void => {
    setSelectedLaneId(timerId)
    setSelectedEntryId(null)
  }, [])
  const handleClearSelection = (): void => {
    setSelectedEntryId(null)
    setSelectedLaneId(null)
  }

  // ---------------------------------------------------------------------------
  // Drag tooltip
  // ---------------------------------------------------------------------------

  const [dragTooltip, setDragTooltip] = useState<{
    startEpoch: EpochSeconds
    endEpoch: EpochSeconds
  } | null>(null)

  // ---------------------------------------------------------------------------
  // Wheel — zoom/pan ONLY over the time axis (D-08); lanes scroll natively otherwise
  // ---------------------------------------------------------------------------

  const handleWheel = useCallback((e: WheelEvent): void => {
    const axisTrackEl = (e.target as Element).closest('[data-gantt-axis-track]')
    if (!axisTrackEl) return // over lanes/gutter → allow native vertical scroll
    e.preventDefault()

    const rect = axisTrackEl.getBoundingClientRect()
    const trackW = Math.max(1, rect.width)
    const store = useGanttViewportStore.getState()

    if (e.shiftKey) {
      // Shift+Scroll over the axis: pan
      const panDelta = (e.deltaY / trackW) * store.spanSeconds
      store.setStartEpoch(store.startEpoch + panDelta)
      return
    }

    // Zoom: clamp span, pivot on the cursor epoch so the point under the cursor stays put
    const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    const newSpan = Math.min(MAX_SPAN_SECONDS, Math.max(MIN_SPAN_SECONDS, store.spanSeconds * factor))
    if (newSpan === store.spanSeconds) return

    const cursorX = Math.min(trackW, Math.max(0, e.clientX - rect.left))
    const tvp: GanttViewport = {
      startEpoch: store.startEpoch as EpochSeconds,
      spanSeconds: store.spanSeconds,
      canvasWidthPx: trackW,
    }
    const cursorEpoch = xToEpoch(cursorX, tvp)
    const fraction = cursorX / trackW
    store.setZoom(cursorEpoch - fraction * newSpan, newSpan)
  }, [])

  // Attach wheel on the ROOT so it also covers the axis (which sits above the lane area).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ---------------------------------------------------------------------------
  // Empty-track pointer drag → horizontal pan (D-09)
  // ---------------------------------------------------------------------------

  interface PanDragState {
    pending: boolean
    active: boolean
    startX: number
    startEpoch: number
    pointerId: number
  }

  const panRef = useRef<PanDragState>({ pending: false, active: false, startX: 0, startEpoch: 0, pointerId: -1 })

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const target = e.target as Element
    if (target.closest('[data-testid="gantt-bar"]')) return
    if (target.closest('[data-handle]')) return
    if (target.closest('button, input, textarea, [data-gantt-gutter], [cmdk-root]')) return
    panRef.current = {
      pending: true,
      active: false,
      startX: e.clientX,
      startEpoch: useGanttViewportStore.getState().startEpoch,
      pointerId: e.pointerId,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    if (!pan.pending && !pan.active) return
    const dx = e.clientX - pan.startX
    if (!pan.active) {
      if (Math.abs(dx) < PAN_THRESHOLD_PX) return
      pan.active = true
      if (typeof e.currentTarget.setPointerCapture === 'function') {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    }
    const store = useGanttViewportStore.getState()
    const trackW = Math.max(1, store.canvasWidthPx * (1 - gutterRef.current))
    const epochDelta = (dx / trackW) * store.spanSeconds
    store.setStartEpoch(pan.startEpoch - epochDelta)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    if (pan.active && typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(pan.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    panRef.current = { pending: false, active: false, startX: 0, startEpoch: 0, pointerId: -1 }
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

  const { data: timers = [], isError: timersError } = useDayTimers(dayRange.fromEpoch, dayRange.toEpoch)
  const { data: allEntries = [] } = useGanttEntries(startEpoch, startEpoch + spanSeconds)

  // ---------------------------------------------------------------------------
  // Now-line position (D-13)
  // ---------------------------------------------------------------------------

  const [nowEpochState, setNowEpochState] = useState<EpochSeconds>(
    () => Math.floor(performance.timeOrigin / 1000 + performance.now() / 1000) as EpochSeconds,
  )

  useEffect(() => {
    if (tick !== null) {
      const epochMs = performance.timeOrigin + performance.now()
      setNowEpochState(Math.floor(epochMs / 1000) as EpochSeconds)
    }
  }, [tick])

  const nowLineX = epochToX(nowEpochState, trackViewport)
  const showNowLine = nowLineX >= 0 && nowLineX <= trackWidthPx

  // ---------------------------------------------------------------------------
  // Overlap hints (D-27): at span <= 3 days, flag every overlapping entry pair —
  // cross-timer AND same-timer.
  // ---------------------------------------------------------------------------

  const showOverlapHints = spanSeconds <= CROSS_LANE_HINT_MAX_SPAN
  const overlapRegions: Array<{ leftX: number; rightX: number }> = []
  if (showOverlapHints && allEntries.length > 1) {
    const viewEnd = startEpoch + spanSeconds
    for (let i = 0; i < allEntries.length; i++) {
      const a = allEntries[i]!
      const aEnd = a.end_timestamp ?? viewEnd
      for (let j = i + 1; j < allEntries.length; j++) {
        const b = allEntries[j]!
        const bEnd = b.end_timestamp ?? viewEnd
        const overlapStart = Math.max(a.start_timestamp, b.start_timestamp)
        const overlapEnd = Math.min(aEnd, bEnd)
        if (overlapStart < overlapEnd) {
          overlapRegions.push({
            leftX: epochToX(overlapStart as EpochSeconds, trackViewport),
            rightX: epochToX(overlapEnd as EpochSeconds, trackViewport),
          })
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
      ref={rootRef}
      className={styles.ganttView}
      data-testid="gantt-view"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClearSelection}
    >
      {/* Info popover — top-left, over the axis gutter spacer */}
      <div className={styles.infoBtn}>
        <GanttInfoPopover />
      </div>

      {/* Zoom-to-fit — top-right; frames the selected day's entries */}
      <button
        type="button"
        className={styles.fitBtn}
        onClick={handleZoomToFit}
        aria-label="Zoom to fit"
        title="Zoom to fit"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          {/* Four corner brackets — "fit to frame" */}
          <path d="M2 5V3a1 1 0 0 1 1-1h2" />
          <path d="M11 2h2a1 1 0 0 1 1 1v2" />
          <path d="M14 11v2a1 1 0 0 1-1 1h-2" />
          <path d="M5 14H3a1 1 0 0 1-1-1v-2" />
        </svg>
      </button>

      {/* Sticky axis header — wheel zoom/pan surface */}
      <GanttAxisHeader viewport={trackViewport} gutterWidthPct={gutterWidthPct} />

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
            {/* Overlap hint bands (D-27) */}
            {overlapRegions.map((region, i) => (
              <div
                key={i}
                className={styles.overlapHint}
                style={{
                  left: `${region.leftX + gutterPx}px`,
                  width: `${region.rightX - region.leftX}px`,
                }}
              />
            ))}

            {/* Now line (D-13) */}
            {showNowLine && (
              <div
                className={styles.nowLine}
                style={{ left: `${nowLineX + gutterPx}px` }}
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
                  viewport={trackViewport}
                  gutterWidthPct={gutterWidthPct}
                  selectedEntryId={selectedEntryId}
                  laneSelected={selectedLaneId === timer.id}
                  onSelectEntry={handleSelectEntry}
                  onSelectLane={handleSelectLane}
                  onDragTooltip={setDragTooltip}
                  onCreateEntryAt={handleCreateEntryAt}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Ghost add-lane (D-22) — pinned below lanes */}
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
