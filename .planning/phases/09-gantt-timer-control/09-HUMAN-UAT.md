---
status: diagnosed
phase: 09-gantt-timer-control
source: [09-07-PLAN.md]
started: 2026-06-18
updated: 2026-06-18
---

## Current Test

[round 1 failed — defects diagnosed and fix applied; awaiting re-test]

## Tests

### 1. SC-1 — Tab strip + persistence
expected: Header shows "Timers | Gantt | Projects" tab strip (no `<h1>Timers</h1>`). Week-total pill visible on all three tabs. Switch to Gantt, quit, relaunch → reopens on Gantt (last tab persisted). Fresh profile defaults to Timers.
result: [pending]

### 2. SC-2 — Canvas / zoom / pan / re-center
expected: One lane per timer; entries are continuous bars (midnight-crossing bar NOT clipped). Default view = current day. Scroll-wheel zooms (clamp ~1h–7d). Shift+Scroll pans; empty-canvas click-drag pans (D-09). Toolbar prev/next/today re-centers timeline.
result: [pending]

### 3. SC-3 — Drag reschedule + persist + snap
expected: Edge-drag changes start/end; body-drag moves entry preserving duration. Drops snap to clean times; Alt = free un-snapped drag (D-18). Quit/relaunch → new timestamps persisted.
result: [pending]

### 4. SC-4 — Running bar + create + editor + delete
expected: Running entry is live pulsing bar (D-19), right edge advances toward now (D-13), right edge NOT draggable, left edge is; stop icon stops timer then end edge becomes draggable. Double-click empty lane → new snapped entry. Bottom ghost lane creates new timer. Double-click bar → TimestampEditor opens. Select+Delete and right-click→Delete Entry → confirm dialog, confirm removes bar.
result: [pending]

### 5. SC-5 — Gutter
expected: Each lane gutter shows project dropdown above editable description; lane grows for multi-line description. Splitter resizes gutter; quit/relaunch → gutter width restored.
result: [pending]

### 6. SC-6 — Inline Projects
expected: Projects tab renders projects manager INLINE in main window (not a separate OS window). Footer Projects link gone; footer version button remains, opens GitHub releases page.
result: [pending]

### 7. Manual-only visual spot-checks
expected: Running-bar pulse animation (D-19); same-lane overlapping entries stack on sub-rows (D-26); very short entry still renders at clickable min width (D-28); faint cross-lane overlap band appears only when zoomed ≤ 3 days (D-27).
result: [pending]

## Summary

total: 7
passed: 0
issues: 5
pending: 7
skipped: 0
blocked: 0

## Gaps

### Round 1 (2026-06-18) — operator findings

- **G1 — Axis unreadable**: at single-day view the time axis shows so many overlapping
  ticks/labels it looks fully filled in.
  root cause: `tickIntervalFor(86400)` — default day span is exactly 86400s; `86400 > 86400`
  is false so it fell through to the 15-minute bracket → 96 ticks across the canvas.
  fix: rebracket `tickIntervalFor` so 1-day = hourly (24 ticks) and tick count stays bounded.

- **G2 — Bars disappear on zoom; ValidationError**: scroll-wheel zoom makes bars vanish and
  only sometimes reappear back at the original zoom. Console: `ValidationError: [VALIDATION]
  fromEpoch: Expected integer, received float; toEpoch: Expected integer, received float`.
  root cause: wheel-zoom/pan set `viewport.startEpoch` to a float; `useGanttEntries` passed it
  straight to `timeEntries.listInRange`, whose Zod contract requires `.int()` → every viewport
  query rejected → no entries returned.
  fix: floor/ceil the range at the `useGanttEntries` boundary; round all epochs at every IPC
  mutation boundary (create/setStart/setEnd/setTimestamps).

- **G3 — Drag jumps back**: dragging a bar partly works but sometimes fails to apply and snaps
  to the original position.
  root cause: same float bug — after a successful drag commit the gantt key is invalidated and
  refetched with a float viewport, the refetch throws, the cache keeps the old entry, and the
  bar's display position resets to the pre-drag timestamp.
  fix: covered by G2 (integer epochs).

- **G4 — Double-click does not create an entry; "New timer" ghost lane does nothing**:
  root cause: `GanttView` root `onPointerDown` calls `setPointerCapture` on every pointer-down
  (any non-bar/non-handle target) and never releases it, stealing the click/double-click from
  child controls and the ghost-lane button.
  fix: only begin panning after a movement threshold, guard interactive targets
  (gutter/buttons/inputs), and release pointer capture on pointer-up.

- **G5 — Project dropdown does nothing when clicked**:
  root cause: same pointer-capture theft as G4 — the gutter combobox trigger sits inside the
  pan surface.
  fix: covered by G4 (mark the gutter as a no-pan zone + threshold pan).

status: all five fixed; full automated suite green.

### Round 2 (2026-06-18) — operator re-test

Confirmed working after round 1: double-click to add entry; red overlap highlighting on
all overlapping entries incl. same-timer; editing project via dropdown and timer
description. Remaining issues:

- **G6 — Axis labels still overlap**: tick count was span-bracketed, not width-aware.
  fix: `chooseTickInterval` now picks the smallest "nice" interval whose pixel spacing
  clears 64px, so label density adapts to canvas width at every zoom.
- **G7 — Some bars unselectable (still show crosshair on hover)**: bars/ticks/now-line
  were scaled to the full lane-area width but rendered inside the narrower bar track
  (`overflow: hidden`), so the right ~25% of the timeline overflowed and was unclickable.
  fix: introduced a track-width viewport; all geometry now uses (canvas − gutter) width.
- **G8 — Info icon overlapped the time axis**: moved to the top-left over the axis gutter
  spacer (no ticks there), popover opens downward.
- **G9 — Scroll behavior**: zoom now only engages over the time axis; over the bars the
  wheel scrolls the timer list normally.
- **G10 — Description padding / no auto-size on mount**: trimmed textarea padding;
  it now auto-sizes to content on mount, not only while editing.
- **G11 — Zoom/scroll not retained across tabs**: viewport moved to a session store
  (useGanttViewportStore); re-center only on actual day change.
- **G12 — Rename**: the "Gantt" tab is now labelled "Timeline".

status: all round-2 items fixed in commit below; full automated suite green; awaiting operator re-test.
</content>
</invoke>
