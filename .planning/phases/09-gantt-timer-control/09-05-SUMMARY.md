---
phase: 09-gantt-timer-control
plan: "05"
subsystem: renderer
tags: [gantt, drag, interaction, components, zustand, react-memo, tdd]
dependency_graph:
  requires: ["09-02", "09-03"]
  provides: ["GanttBar", "useConfirmDeleteEntryStore", "ConfirmEntryDeleteDialog", "GanttDragTooltip"]
  affects: ["09-06"]
tech_stack:
  added: []
  patterns:
    - "React.memo for tick-store subscriber (same as DurationCell)"
    - "Drag state in useRef<DragState> (not useState) to avoid render per pointer-move"
    - "Atomic setTimestamps for body-move (Pitfall 3 avoided)"
    - "Running-bar right handle omitted from DOM (Pitfall 2 avoided)"
    - "Parallel confirm store + dialog pattern (mirrors useConfirmDeleteStore + ConfirmDialog)"
key_files:
  created:
    - src/renderer/src/components/gantt/GanttBar.tsx
    - src/renderer/src/components/gantt/GanttBar.module.css
    - src/renderer/src/components/gantt/GanttBar.test.tsx
    - src/renderer/src/stores/useConfirmDeleteEntryStore.ts
    - src/renderer/src/components/gantt/ConfirmEntryDeleteDialog.tsx
    - src/renderer/src/components/gantt/ConfirmEntryDeleteDialog.module.css
    - src/renderer/src/components/gantt/ConfirmEntryDeleteDialog.test.tsx
    - src/renderer/src/components/gantt/GanttDragTooltip.tsx
    - src/renderer/src/components/gantt/GanttDragTooltip.module.css
  modified: []
decisions:
  - "GanttBar uses setPointerCapture guarded by typeof check for jsdom compatibility in tests (no behavior change in production Electron)"
  - "useConfirmDeleteEntryStore created as parallel to useConfirmDeleteStore — mirrors exact shape {pendingDelete, open, close}"
  - "ConfirmEntryDeleteDialog drives useDeleteEntry (not useDeleteTimer) — resolves PATTERNS 'No Analog Found' gap"
metrics:
  duration: "6m"
  completed_date: "2026-06-18"
  tasks: 2
  files: 9
---

# Phase 09 Plan 05: GanttBar and Entry-Delete Confirm Path Summary

**One-liner:** React.memo GanttBar with pointer-capture drag, tick-driven running edge, entry-delete confirm dialog backed by useDeleteEntry, and floating drag tooltip.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | GanttBar failing tests | a1653a8 | GanttBar.test.tsx, useConfirmDeleteEntryStore.ts |
| 1 (GREEN) | GanttBar implementation | b46ded6 | GanttBar.tsx, GanttBar.module.css |
| 2 | Entry-delete confirm + drag tooltip | 9f8b5c8 | ConfirmEntryDeleteDialog.tsx/css/test, GanttDragTooltip.tsx/css |

## What Was Built

### GanttBar (SC-3, SC-4)

The core interactive primitive of the Gantt canvas:

- **React.memo-wrapped** with `useTickStore` subscription for running-bar right-edge tracking (D-19). Running entry's right edge is computed from `tick.elapsedSeconds` when `tick.timerId === timer.id`.
- **Running bar DOM omission (Pitfall 2):** The right-edge handle is absent from the JSX tree entirely for running entries — not hidden via CSS.
- **Drag state via useRef:** `useRef<DragState>` stores `{kind, startX, origStart, origEnd}` to avoid re-renders per pointer-move. Only the `displayPos` `useState` triggers visual updates.
- **setPointerCapture** called in `handlePointerDown` to lock pointer events during drag.
- **Edge-resize:** Left handle → `useSetEntryStart.mutate`; right handle → `useSetEntryEnd.mutate` (D-17).
- **Body-move:** `window.api.timeEntries.setTimestamps` (atomic, D-20, Pitfall 3) + triple-cache invalidation via `useSetEntryBounds` inline mutation.
- **Zoom-aware snap:** `snapEpoch(value, snapIncrementFor(viewport.spanSeconds), e.altKey)` (D-18).
- **Stop icon (D-13):** Fires `useStopTimer.mutate(timer.id)`.
- **Select (D-25):** `onClick → onSelect(entry.id)`.
- **Double-click (D-23):** `window.api.editor.open(entry.timer_id)`.
- **Context menu (D-24):** "Open Editor" + "Delete Entry" — Delete Entry calls `useConfirmDeleteEntryStore.getState().open(entry.id, label)`.
- **Keyboard delete (D-24):** Delete/Backspace when `selected=true` opens the confirm store.
- **Minimum 8px width (D-28):** `Math.max(8, rawWidth)` applied in `computePos`.

### useConfirmDeleteEntryStore

Zustand store mirroring `useConfirmDeleteStore` for entries: `{ pendingDelete: {id, label} | null, open(id, label), close() }`.

### ConfirmEntryDeleteDialog

- Native `<dialog>` driven by `useConfirmDeleteEntryStore` (reactive open/close via `useEffect`).
- Drives `useDeleteEntry().mutateAsync({ entryId })` — NOT `useDeleteTimer`.
- Resolves the PATTERNS "No Analog Found" gap.
- Exact D-24 copy: title "Delete entry?" / body "This will permanently remove the time entry. This cannot be undone." / button "Delete".
- Gantt key invalidation lives in `useDeleteEntry` (patched by 09-03) — this dialog adds none.

### GanttDragTooltip

Presentational floating div: Start HH:MM / End HH:MM / Duration H:MM computed from epoch props (D-20). Monospace, `--color-bg-elevated`, `--color-border`, `--radius-sm`.

## Test Results

```
✓ GanttBar.test.tsx (5 tests)
  - running-handle-omitted: running entry omits right-edge handle from DOM
  - both-handles: stopped entry renders both edge handles
  - min-width: tiny-duration entry renders >= 8px width
  - dblclick-editor: double-click calls window.api.editor.open(timer_id)
  - delete-opens-confirm: Delete key on selected bar opens useConfirmDeleteEntryStore

✓ ConfirmEntryDeleteDialog.test.tsx (4 tests)
  - dialog closed when pendingDelete null
  - dialog opens with "Delete entry?" copy when store opens
  - Delete button calls timeEntries.deleteEntry(id) and closes
  - Cancel button closes without IPC call
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] setPointerCapture guarded for jsdom compatibility**
- **Found during:** Task 1 (first test run)
- **Issue:** `e.currentTarget.setPointerCapture` is not implemented in jsdom, causing unhandled exceptions in the dblclick-editor test (which triggers a pointerdown event as part of userEvent.dblClick).
- **Fix:** Added `typeof e.currentTarget.setPointerCapture === 'function'` guard. In production Electron (Chromium) this always evaluates true — no behavior change. In jsdom tests, the guard prevents the exception while the capture semantics remain untested (acceptable; pointer capture is a DOM API tested in e2e, not unit).
- **Files modified:** `GanttBar.tsx`
- **Commit:** b46ded6

## TDD Gate Compliance

Task 1 followed the RED/GREEN/REFACTOR cycle:
- RED commit: `a1653a8` — `test(09-05): add failing tests for GanttBar (TDD RED)` — tests fail (module not found)
- GREEN commit: `b46ded6` — `feat(09-05): implement GanttBar ...` — all 5 tests pass

## Self-Check: PASSED
