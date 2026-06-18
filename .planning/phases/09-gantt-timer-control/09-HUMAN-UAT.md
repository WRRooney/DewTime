---
status: partial
phase: 09-gantt-timer-control
source: [09-07-PLAN.md]
started: 2026-06-18
updated: 2026-06-18
---

## Current Test

[awaiting human testing — launch `npm run dev` (or `npm run dev:no-sandbox`) and verify each criterion below]

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
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
</content>
</invoke>
