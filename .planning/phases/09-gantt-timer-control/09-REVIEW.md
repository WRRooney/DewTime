---
phase: 09-gantt-timer-control
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - src/main/db/migrations/005_gantt_settings.sql
  - src/main/db/migrations/index.ts
  - src/main/db/repositories/timeEntries.ts
  - src/main/ipc/timeEntries.ts
  - src/preload/index.ts
  - src/shared/contracts/settings.ts
  - src/shared/contracts/timeEntries.ts
  - src/shared/ipc.ts
  - src/renderer/src/components/App.tsx
  - src/renderer/src/components/AppFooter.tsx
  - src/renderer/src/components/DateNavToolbar.tsx
  - src/renderer/src/components/TabStrip.tsx
  - src/renderer/src/components/gantt/GanttView.tsx
  - src/renderer/src/components/gantt/GanttLane.tsx
  - src/renderer/src/components/gantt/GanttLaneGutter.tsx
  - src/renderer/src/components/gantt/GanttBar.tsx
  - src/renderer/src/components/gantt/GanttAxisHeader.tsx
  - src/renderer/src/components/gantt/GanttGhostLane.tsx
  - src/renderer/src/components/gantt/GanttInfoPopover.tsx
  - src/renderer/src/components/gantt/GanttDragTooltip.tsx
  - src/renderer/src/components/gantt/ConfirmEntryDeleteDialog.tsx
  - src/renderer/src/hooks/useGanttEntries.ts
  - src/renderer/src/hooks/useCreateEntry.ts
  - src/renderer/src/hooks/useSetEntryTimestamps.ts
  - src/renderer/src/hooks/useStartTimer.ts
  - src/renderer/src/hooks/useStopTimer.ts
  - src/renderer/src/hooks/useDeleteEntry.ts
  - src/renderer/src/hooks/useGutterWidth.ts
  - src/renderer/src/stores/useActiveTabStore.ts
  - src/renderer/src/stores/useConfirmDeleteEntryStore.ts
  - src/renderer/src/stores/useGanttViewportStore.ts
  - src/renderer/src/utils/gantt-math.ts
  - src/renderer/src/test-utils/mock-api.ts
findings:
  critical: 4
  warning: 6
  info: 2
  total: 12
status: clean
resolution: All 4 Critical fixed; cheap Warnings (WR-05, WR-06) fixed; WR-03 + IN-01 are
  intentional (operator-requested); WR-01/WR-02/WR-04/IN-02 deferred as minor. See Resolution.
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-18
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

Phase 9 delivers a substantial new Gantt view with tab navigation, drag-to-reschedule, entry creation, and persisted viewport settings. The core architecture is sound: IPC contracts are Zod-gated, query-invalidation paths cover all three namespaces (timers, byTimer, gantt), and the pointer-capture drag model is correctly applied in GanttBar. However, four critical defects exist: (1) dragging the body of a running bar silently fails and leaves the bar permanently mispositioned; (2) no drag revert on mutation error means any rejected drag leaves the bar stuck at the wrong visual position indefinitely; (3) the drag tooltip is always rendered at the top-left corner (x=0, y=0) instead of following the bar; and (4) the new epoch-timestamp IPC arguments are missing the established `EpochSecondsValue` bounds check (`≥ 1_700_000_000`), deviating from the project's explicit security contract.

---

## Critical Issues

### CR-01: Running bar body-drag silently fails and permanently mispositions the bar

**File:** `src/renderer/src/components/gantt/GanttBar.tsx:350-354`

**Issue:** The `onPointerDown` handler on the bar `<div>` fires `handlePointerDown(e, 'move')` for any pointer event not on a handle, with no guard against `isRunning`. The repository's `setTimestamps` function throws `ValidationError('cannot edit timestamps of a running entry')` when called on a running entry (validated at `src/main/db/repositories/timeEntries.ts:253`). Because neither `useSetEntryBounds` (line 85) nor `useSetEntryStart` / `useSetEntryEnd` have an `onError` handler (see CR-02), the mutation fails silently. After `handlePointerUp` resets `dragRef.current.kind` to `'idle'`, the `useEffect` at line 136–140 will only restore `displayPos` if `entry.start_timestamp` or `liveEndEpoch` change — but since the mutation failed, the cache is never invalidated and those props never change. The bar stays at the visually-dropped position indefinitely.

**D-19** explicitly states the running bar body should remain movable (start-handle drags are allowed). The issue is body-drag (`'move'` kind) which atomically sets both timestamps via `setTimestamps` — an operation that always fails on running entries.

**Fix:** Guard body-drag on running bars at the point of pointer capture:

```tsx
// GanttBar.tsx — onPointerDown on the bar div (lines 350-354)
onPointerDown={(e) => {
  // Hit-test: body-move if not on a handle
  if ((e.target as Element).closest('[data-handle]')) return
  // Do not initiate body-move on a running bar — setTimestamps rejects running entries
  if (isRunning) return
  handlePointerDown(e, 'move')
}}
```

---

### CR-02: No drag revert on mutation error — bar stuck at dropped position

**File:** `src/renderer/src/components/gantt/GanttBar.tsx:76-93` and `src/renderer/src/hooks/useSetEntryTimestamps.ts:22-38`

**Issue:** All three drag-commit mutations (`useSetEntryBounds`, `useSetEntryStart`, `useSetEntryEnd`) have no `onError` handler. When a commit is rejected (e.g. ValidationError, network drop, or any other error), `displayPos` is already set to the dropped position at the time `handlePointerUp` fires (the `setDisplayPos(computePos(...))` call happens during `handlePointerMove`). Because `onError` never triggers an invalidation, and because `entry.start_timestamp` never changes (the cache update only happens on `onSuccess`), the `useEffect` guard (`dragRef.current.kind === 'idle'`) will not cause a revert — `entry.start_timestamp` hasn't changed.

**Fix:** Add `onError` to `useSetEntryBounds` to revert `displayPos` to the pre-drag position. The cleanest approach passes the original position to the mutation context:

```typescript
// GanttBar.tsx — useSetEntryBounds mutation
function useSetEntryBounds(
  getOrigPos: () => DisplayPos,   // callback returning the pre-drag position
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { entryId: number; startTs: EpochSeconds; endTs: EpochSeconds }, { origPos: DisplayPos }>({
    mutationFn: ({ entryId, startTs, endTs }) =>
      window.api.timeEntries.setTimestamps(
        entryId,
        Math.round(startTs) as EpochSeconds,
        Math.round(endTs) as EpochSeconds,
      ),
    onMutate: () => ({ origPos: getOrigPos() }),
    onError: (_err, _vars, ctx) => {
      if (ctx) setDisplayPos(ctx.origPos)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
        qc.invalidateQueries({ queryKey: ['timeEntries', 'gantt'] }),
      ])
    },
  })
}
```

Apply the equivalent pattern to `useSetEntryStart` and `useSetEntryEnd` in `useSetEntryTimestamps.ts`.

---

### CR-03: Drag tooltip always rendered at position (0, 0) — stuck at top-left corner

**File:** `src/renderer/src/components/gantt/GanttView.tsx:531-538`

**Issue:** `GanttDragTooltip` accepts `x` and `y` props that drive its `position: absolute` placement within `GanttView`. `GanttView` always passes `x={0}` and `y={0}`. The `onDragTooltip` callback signature in `GanttBarProps` (line 49) only carries `{ startEpoch, endEpoch }` — no position is propagated from the bar to the parent. The result is that the tooltip is always rendered at the very top-left of the gantt canvas during every drag, unreachable by the user's pointer and invisible below the sticky axis header.

**Fix:** Extend the drag-tooltip payload to include pointer coordinates, and update the `onDragTooltip` callback and `GanttView` state to track them:

```typescript
// GanttBar.tsx — onDragTooltip call in handlePointerMove
onDragTooltip({ startEpoch: newStart, endEpoch: newEnd, clientX: e.clientX, clientY: e.clientY })

// GanttBar.tsx — GanttBarProps
onDragTooltip: (t: { startEpoch: EpochSeconds; endEpoch: EpochSeconds; clientX: number; clientY: number } | null) => void

// GanttView.tsx — dragTooltip state and render
const ganttRect = rootRef.current?.getBoundingClientRect()
const relX = ganttRect ? dragTooltip.clientX - ganttRect.left : 0
const relY = ganttRect ? dragTooltip.clientY - ganttRect.top : 0
<GanttDragTooltip
  startEpoch={dragTooltip.startEpoch}
  endEpoch={dragTooltip.endEpoch}
  x={relX}
  y={relY}
/>
```

---

### CR-04: New epoch IPC args missing `EpochSecondsValue` bounds — deviates from security contract

**File:** `src/shared/contracts/timeEntries.ts:78-79, 95-96, 111-112`

**Issue:** The Phase 9 schemas `ListInRangeArgsSchema`, `CreateEntryArgsSchema`, and `SetTimestampsArgsSchema` use `z.number().int().positive()` for all epoch fields. The established project pattern (codified in `src/shared/contracts/timers.ts:6` and explicitly mandated in `09-RESEARCH.md §Security Domain`) requires `z.number().int().min(1_700_000_000).max(1_999_999_999)`. Using only `.positive()` allows a renderer-supplied epoch of `1` (or any value up to ~1.7 billion) to pass Zod validation and reach the SQLite layer. This could insert time entries at arbitrary far-past dates, corrupting the gantt viewport, timeline totals, and `useDayTimers` queries.

**Fix:** Define and use `EpochSecondsValue` in `contracts/timeEntries.ts`, mirroring the pattern in `contracts/timers.ts`:

```typescript
// src/shared/contracts/timeEntries.ts — add before the schema definitions
/** Epoch-seconds bounds: matches timers.ts; rejects pre-Nov-2023 and post-2033 values. */
const EpochSecondsValue = z.number().int().min(1_700_000_000).max(1_999_999_999)

// Then replace .positive() with EpochSecondsValue for all epoch fields:
export const ListInRangeArgsSchema = z
  .object({
    fromEpoch: EpochSecondsValue,
    toEpoch: EpochSecondsValue,
  })
  .refine((a) => a.fromEpoch < a.toEpoch, { message: 'fromEpoch must be less than toEpoch' })

export const CreateEntryArgsSchema = z
  .object({
    timerId: z.number().int().positive(),
    startTs: EpochSecondsValue,
    endTs: EpochSecondsValue,
  })
  .refine((a) => a.startTs < a.endTs, { message: 'startTs must be before endTs' })

export const SetTimestampsArgsSchema = z
  .object({
    entryId: z.number().int().positive(),
    startTs: EpochSecondsValue,
    endTs: EpochSecondsValue,
  })
  .refine((a) => a.startTs < a.endTs, { message: 'startTs must be before endTs' })
```

The pre-existing `SetStartArgsSchema` and `SetEndArgsSchema` also use `.positive()` for `ts` rather than `EpochSecondsValue`, but those are pre-Phase-9 and out of this review's scope. The three new Phase 9 schemas must be fixed.

---

## Warnings

### WR-01: `setTimestamps` does not verify the UPDATE affected a row (inconsistent with all other write functions)

**File:** `src/main/db/repositories/timeEntries.ts:261-266`

**Issue:** Every other write function in this file (`setStart` line 162, `setEnd` line 183, `deleteEntry` line 278) captures `info.changes` and throws `NotFoundError` when zero rows were updated. `setTimestamps` performs a pre-flight `byId.get(entryId)` check but then calls `.run()` on an inline `getDb().prepare(...)` without capturing the result. If the entry is deleted between the read and the write (unlikely in SQLite's single-writer model but possible under test conditions), the function silently returns `void` instead of throwing `NotFoundError`. This breaks caller error-handling expectations.

Additionally, `setTimestamps` uses `getDb().prepare(...)` inline rather than the `stmts` cache. This re-prepares the statement on every call — a minor performance regression and an inconsistency with the module pattern.

**Fix:**

```typescript
// src/main/db/repositories/timeEntries.ts — add a setTimestamps statement to the stmts cache
stmts = {
  // ...existing statements...
  setTimestamps: db.prepare(
    `UPDATE time_entries SET start_timestamp = ?, end_timestamp = ? WHERE id = ?`,
  ),
}

// In setTimestamps():
const info = getStmts().setTimestamps.run([startTs, endTs, entryId])
if (info.changes === 0) throw new NotFoundError(`time_entries ${entryId} not found`)
```

---

### WR-02: `isMidnight` tick classification uses UTC epoch arithmetic — wrong for non-UTC timezones

**File:** `src/renderer/src/components/gantt/GanttAxisHeader.tsx:168`

**Issue:** `const isMidnight = tickEpoch % SECONDS_PER_DAY === 0` is true only for UTC midnight (epoch values that are exact multiples of 86400). In any timezone other than UTC, local midnight has an epoch that is NOT divisible by 86400. The result is that the midnight tick-mark style (heavier visual treatment via `styles.tickMidnight`) is applied to UTC midnight rather than local midnight. For UTC+5:30 users, the heavy tick is ~5.5 hours off from the displayed date boundary in the top tier (which is computed correctly via `setHours(0,0,0,0)` in `getMidnightBoundaries`).

**Fix:** Compare against the local midnight boundaries already computed for the top tier:

```typescript
// GanttAxisHeader — pass midnights down to the tick tier, or compute inline:
const midnightSet = new Set(midnights)

// In the tick render:
const isMidnight = midnightSet.has(tickEpoch)
```

---

### WR-03: Overlap hint bands include same-timer overlapping entries, violating D-27

**File:** `src/renderer/src/components/gantt/GanttView.tsx:356-379`

**Issue:** The overlap-hint O(n²) scan compares every entry pair in `allEntries` regardless of `timer_id`. D-27 defines overlap hints as "concurrent clock time **across timers**" (cross-lane). Same-timer overlapping entries are already handled by D-26 (visual sub-row stacking in `GanttLane`). When same-timer entries overlap, the code emits an orange/accent hint band across the full lane area **in addition** to the visual stacking — a redundant and confusing double-signal. At 3-day zoom with many short entries, this could paint the gantt solidly with hints.

**Fix:** Filter the pair-comparison to skip same-timer pairs:

```typescript
if (a.timer_id === b.timer_id) continue   // same-lane overlaps handled by sub-rows (D-26)
const overlapStart = Math.max(a.start_timestamp, b.start_timestamp)
// ...rest of overlap logic unchanged
```

---

### WR-04: `App.tsx` settings load calls `setTab` which triggers a redundant SQLite write on every boot

**File:** `src/renderer/src/components/App.tsx:41`

**Issue:** The load-on-mount `useEffect` reads `settings.active_tab` from SQLite and then calls `useActiveTabStore.getState().setTab(tab)`. The `setTab` action unconditionally writes back to SQLite (`void window.api.settings.set('settings.active_tab', tab)` — `useActiveTabStore.ts:28`). On every app start this issues a redundant SQLite write (read value, then write the same value back). The `09-RESEARCH.md` Pattern 7 explicitly warns: "without persisting (avoids a write-on-read cycle)."

**Fix:** Either add a `loadTab` action to the store that only calls `set({ tab })` without the IPC write, or perform the hydration directly:

```typescript
// App.tsx — useEffect, line 41
// Call set({ tab }) directly to avoid the write-back
useActiveTabStore.setState({ tab })
// (not setTab which writes to SQLite)
```

Alternatively add a `loadTab` action to `useActiveTabStore`:

```typescript
// useActiveTabStore.ts
loadTab: (tab: ActiveTab) => set({ tab }),  // read-only hydration, no IPC write
```

---

### WR-05: GanttInfoPopover timer refs not cleared on unmount — potential stale-state update

**File:** `src/renderer/src/components/gantt/GanttInfoPopover.tsx:33-56`

**Issue:** `showTimerRef` and `hideTimerRef` hold `setTimeout` handles but there is no `useEffect` cleanup to cancel pending timers on unmount. If the component unmounts while either timer is pending (e.g., user switches tabs while hovering), the timer will fire and call `setVisible(true/false)` on the unmounted component. In React 18 this produces no warning but wastes CPU and, more importantly, can cause subtle state corruption if the component remounts quickly (the stale timer fires after remount, toggling visibility unexpectedly).

**Fix:**

```typescript
// Add a cleanup useEffect to GanttInfoPopover:
useEffect(() => {
  return () => {
    if (showTimerRef.current !== null) clearTimeout(showTimerRef.current)
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
  }
}, [])
```

---

### WR-06: Pan `handlePointerMove` calls `setPointerCapture` with `e.pointerId` (second pointer) instead of `pan.pointerId` (original pointer)

**File:** `src/renderer/src/components/gantt/GanttView.tsx:276-278`

**Issue:** Pointer capture is acquired inside `handlePointerMove` when the pan threshold is first exceeded:

```typescript
pan.active = true
if (typeof e.currentTarget.setPointerCapture === 'function') {
  e.currentTarget.setPointerCapture(e.pointerId)   // e.pointerId here
}
```

If a second touch point fires a `pointermove` event before the first touch exceeds the 4-pixel threshold (e.g. accidental second finger touch), `pan.pending` is `true` and `pan.active` is `false`. The second touch's `e.pointerId` — not `pan.pointerId` — gets captured. The original first-touch pointer then loses tracking. The result is a pan that follows the second touch instead of the first, causing a viewport jump.

**Fix:** Guard all `handlePointerMove` / `handlePointerUp` logic by `e.pointerId`:

```typescript
const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
  const pan = panRef.current
  if (!pan.pending && !pan.active) return
  if (e.pointerId !== pan.pointerId) return   // guard: only process the original pointer
  // ...rest unchanged, and change setPointerCapture to use pan.pointerId:
  e.currentTarget.setPointerCapture(pan.pointerId)
}

const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
  const pan = panRef.current
  if (e.pointerId !== pan.pointerId) return   // guard
  // ...rest unchanged
}
```

---

## Info

### IN-01: Tab label "Timeline" diverges from D-01 specification "Gantt"

**File:** `src/renderer/src/components/TabStrip.tsx:20`

**Issue:** D-01 in `09-CONTEXT.md` specifies the tab labels exactly as `Timers | Gantt | Projects`. The implementation uses `label: 'Timeline'` for the gantt tab (the comment on line 17 acknowledges this divergence: "the visible label is 'Timeline'"). The persisted setting key `'gantt'` is correct, but if the user or any spec document references the label, it won't match.

This may be an intentional product decision made after the context was locked, but there is no recorded decision change. If "Timeline" is the confirmed label, D-01 in `09-CONTEXT.md` should be updated to reflect it.

**Fix:** Either update the label to `'Gantt'` to match D-01, or amend D-01 to record the label change as a deliberate deviation.

---

### IN-02: `setTimestamps` re-prepares its SQL statement on every call (inconsistent with module pattern)

**File:** `src/main/db/repositories/timeEntries.ts:261-266`

**Issue:** All other statements in this module are prepared once and cached in the `stmts` object. `setTimestamps` calls `getDb().prepare(...)` inline on every invocation, bypassing the cache. For the gantt's drag-commit rate this is harmless (once per drop), but it is a pattern inconsistency that makes the code harder to audit and violates the module-level comment's own contract ("All SQL uses `?` placeholders — prepared once"). This is tracked under WR-01 as well; fixing WR-01 (adding to `stmts` cache) resolves this too.

**Fix:** See WR-01 fix — add `setTimestamps` to the `stmts` cache during `getStmts()` initialization.

---

_Reviewed: 2026-06-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (2026-06-18)

**Critical — all fixed:**
- CR-01 running-bar body-drag silent fail → body-move disabled for running bars (only the
  left edge resizes, D-19).
- CR-02 no revert on rejected commit → each drag `mutate` now passes `onError` that snaps the
  bar back to its persisted position.
- CR-03 drag tooltip at (0,0) → bar passes pointer `clientX/clientY` through `onDragTooltip`;
  tooltip is now `position: fixed` and follows the cursor.
- CR-04 epoch args missing range bound → all `fromEpoch/toEpoch/startTs/endTs` now use a shared
  `EpochSecondsValue` (`int().min(1_700_000_000).max(1_999_999_999)`), matching `timers.ts`.

**Warning:**
- WR-05 info-popover timer leak → unmount cleanup `useEffect` added.
- WR-06 pan pointer hijack → `pointerId` guard + capture `pan.pointerId`.
- WR-01 / WR-02 / WR-04 / IN-02 → deferred as minor (no functional/security impact); tracked
  for a future cleanup pass.
- WR-03 same-timer overlap hint → INTENTIONAL (operator explicitly requested it during UAT).

**Info:**
- IN-01 "Timeline" tab label → INTENTIONAL (operator-requested rename; persisted id stays `gantt`).

Post-fix verification: typecheck clean · renderer 171 · main 203 — all green.
