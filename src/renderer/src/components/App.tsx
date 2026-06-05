// src/renderer/src/components/App.tsx
// Composition root — Phase 6 extends the Phase 5 chrome with:
//   - <DateNavToolbar /> as the FIRST child of <main> (above the AddTimerButton toolbar row)
//   - <CalendarPickerDialog /> mounted once at App scope as a sibling of <ConfirmDialog />
//     (NOT inside DateNavToolbar — avoids unmount/remount on toolbar re-renders; T-6-13)
//
// The full composition inside <SettingsProvider>:
//
//   <SettingsProvider>                         ← Phase 3 — unchanged
//     <TickBridge />                           ← Phase 4 — side-effect mount (D-09)
//     <TitleBar onOpenSettings={...} />        ← Phase 3 — unchanged
//     <main className={styles.main}>           ← Phase 4 fills the formerly-empty <main>
//       <DateNavToolbar />                     ← Phase 6 — FIRST child of <main>
//       <div className={styles.toolbar}>
//         <AddTimerButton />
//       </div>
//       <div className={styles.tableWrap}>
//         <TimerTable />
//       </div>
//     </main>
//     <SettingsDialog ref={dialogRef} />       ← Phase 3 — unchanged
//     <ConfirmDialog />                        ← Phase 4 — sibling of SettingsDialog
//     <CalendarPickerDialog />                 ← Phase 6 — mounted once (T-6-13); sibling of ConfirmDialog
//   </SettingsProvider>
//
// Both new Phase 6 components are inside <SettingsProvider> so useSettings() resolves (T-6-14).
// <TickBridge />, <ConfirmDialog />, and <CalendarPickerDialog /> are inside the
// QueryClientProvider scope established by main.tsx (plan 04-06) — they have access
// to TanStack Query hooks.
//
// A-16: renderer never owns the tick interval — that lives in main/services/tick.ts (D-06).
// T-6-13: CalendarPickerDialog mounted EXACTLY ONCE here at App scope; never inside DateNavToolbar.
// Note: TimestampEditor opens in a SEPARATE OS window (DurationCell → window.api.editor.open).
//
// Refs:
//   - 04-CONTEXT.md D-09 (TickBridge mount-once shape)
//   - 04-CONTEXT.md D-23 (AddTimerButton → pendingFocusId → DescriptionCell auto-focus)
//   - 04-CONTEXT.md D-24 (ConfirmDialog store-driven open/close)
//   - 04-UI-SPEC.md § Layout under the title bar (main flex + .toolbar + .tableWrap)
//   - 06-UI-SPEC.md § Layout contract: App.tsx <main> insertion order
//   - 06-PLAN.md plan 06-06 must_haves.truths[0..1]
import { useRef } from 'react'
import styles from './App.module.css'
import { SettingsProvider } from '../contexts/SettingsContext'
import { TitleBar } from './TitleBar'
import { SettingsDialog } from './SettingsDialog'
import { TickBridge } from './TickBridge'
import { ConfirmDialog } from './ConfirmDialog'
import { AddTimerButton } from './AddTimerButton'
import { TimerTable } from './timer-table'
import { DateNavToolbar } from './DateNavToolbar'
import { CalendarPickerDialog } from './CalendarPickerDialog'

export function App(): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const handleOpenSettings = (): void => {
    dialogRef.current?.showModal()
  }

  return (
    <SettingsProvider>
      {/* TickBridge mounts first — subscribes to tick:update before any cell renders (D-09) */}
      <TickBridge />
      <TitleBar onOpenSettings={handleOpenSettings} />
      <main className={styles.main}>
        {/* DateNavToolbar is FIRST child of <main> — above AddTimerButton toolbar (06-UI-SPEC layout contract) */}
        <DateNavToolbar />
        <div className={styles.toolbar}>
          <AddTimerButton />
        </div>
        <div className={styles.tableWrap}>
          <TimerTable />
        </div>
      </main>
      <SettingsDialog ref={dialogRef} />
      {/* ConfirmDialog driven by useConfirmDeleteStore — no ref needed (D-24) */}
      <ConfirmDialog />
      {/* CalendarPickerDialog mounted once at App scope — sibling of ConfirmDialog (T-6-13).
          NOT inside DateNavToolbar to prevent unmount/remount on per-second toolbar re-renders.
          Timestamp editor opens in a SEPARATE OS window (DurationCell → window.api.editor.open). */}
      <CalendarPickerDialog />
    </SettingsProvider>
  )
}
