# Roadmap: Timerz

## Milestones

- ✅ **v1.0 MVP** — Phases 1–2 (shipped 2026-02-25) — See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Phase 3** — Settings Foundation (shipped 2026-03-22) — See completed milestones below
- 📋 **v2.0 Electron Rewrite** — Phases 1–7 (active)

---

## Current Milestone: v2.0 Electron Rewrite

**Goal:** Replace PySide6/Python implementation with Electron + TypeScript/Node at full behavior parity with v1.0 + Phase 3. Drop Python entirely. Local-only single-user.

### Phases

- [ ] **Phase 1: Foundation** - electron-vite scaffold + SQLite schema + typed IPC contract + packaging smoke-test
- [ ] **Phase 2: Timer Service FSM + Crash Recovery** - TimerService + HeartbeatService + powerMonitor + invariant tests
- [ ] **Phase 3: Frameless Window + Settings** - BrowserWindow chrome + drag + always-on-top + geometry persistence + SettingsDialog
- [ ] **Phase 4: Timer Table + Live Duration** - TanStack Table + push-tick architecture + start/stop + duration column + CRUD
- [ ] **Phase 5: Project Combobox + Field Editors** - cmdk type-ahead + new-project flow + TimestampEditorDialog + offset + notes
- [ ] **Phase 6: Date Navigation + Calendar Picker** - prev/next/today + react-day-picker + daily/weekly totals + week-start
- [ ] **Phase 7: Packaging + E2E Hardening** - electron-builder NSIS/AppImage + Playwright/xvfb E2E suite + cross-platform smoke
- [x] **Phase 8: Projects Management + App Footer** - projects CRUD popup + footer (bottom-left link to popup, bottom-right version → releases page)

---

## Phase Details

### Phase 1: Foundation

**Goal**: The build system, database layer, and typed IPC contract are established so every subsequent phase can write features without revisiting infrastructure
**Depends on**: Nothing (first phase of v2.0)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, PKG-01, PKG-02, PKG-04, TEST-01
**Success Criteria** (what must be TRUE):

  1. Running `npm install && npm run dev` produces a working Electron window with no console errors
  2. A smoke-test script opens the SQLite database, inserts a row, reads it back, and exits with code 0
  3. A packaged binary (NSIS or AppImage) opens successfully and the DB smoke-test passes inside the ASAR bundle (no ABI/ASAR failure)
  4. `window.api.*` calls from the renderer resolve against typed IPC channels with no `undefined` or type errors
  5. Vitest runs `nowSeconds()` unit test asserting the returned value is less than `2_000_000_000` (epoch-seconds guard)

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold + native triplet pin (electron 38.0.0 / better-sqlite3 12.9.0 / @electron/rebuild 4.0.1) + electron-vite + tsconfigs + electron-builder + vitest config + bare React renderer + electron-log (Wave 1, autonomous: false — package legitimacy checkpoint)
- [x] 01-02-PLAN.md — Shared module: EpochSeconds branded type + nowSeconds() + Error subclasses with prefix-encoded messages + full v1 IPC surface types + Zod contracts (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-03-PLAN.md — Data layer: singleton database.ts with pragma sequence + migration runner with PRAGMA user_version + 001_initial.sql for 5 tables + 5 repositories with CRUD round-trip tests (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — Main entry + IPC handlers (system.echo + system.dbSmoke) + preload contextBridge with explicit enumeration + renderer env.d.ts + reset-db helper + TIMERZ_SMOKE=1 branch (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Packaged-binary smoke script + Ubuntu/Windows matrix CI workflow + manual npm run dev visual verification (Wave 4, autonomous: false — dev-mode checkpoint)

**UI hint**: yes

---

### Phase 2: Timer Service FSM + Crash Recovery

**Goal**: The TimerService FSM and HeartbeatService are fully implemented and unit-tested before any timer UI is built
**Depends on**: Phase 1
**Requirements**: TIME-03, TIME-06, TIME-07, CRASH-01, CRASH-02, CRASH-03, CRASH-04
**Success Criteria** (what must be TRUE):

  1. Starting timer A while timer B is running leaves exactly one row with `end_timestamp IS NULL` (verified at DB level in test)
  2. A heartbeat row is written within 65 seconds of TimerService.start() being called
  3. After a simulated system sleep+wake, the heartbeat interval continues writing (no freeze)
  4. On app launch with a `NULL end_timestamp` row, `checkResume()` returns the running entry so the UI can show it as active
  5. On app launch with a stale heartbeat (delta > 300s) and a running entry, `checkResume()` returns a crash-suspect flag

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Fill repository stubs: `time_entries.stop(timerId)` + `stopActive()` + 4 added tests (foundation for TIME-03; replaces Phase 1 not-implemented stubs)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — TimerService module (`services/timer.ts`): `start`/`stop`/`stopActive`/`getRunningEntry`/`elapsedSeconds`/`checkResume`/`resetForTests` + `CRASH_THRESHOLD_SECONDS=300` + `db.transaction` wrapper + 5 vitest cases including TIME-03 DB-level COUNT(*) assertion (TIME-03, TIME-06, TIME-07)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — HeartbeatService module (`services/heartbeat.ts`): `startHeartbeat`/`stopHeartbeat`/`writeHeartbeat`/`resetForTests` + `HEARTBEAT_INTERVAL_MS=60_000` + 4 vitest cases with `vi.useFakeTimers()` + wire `startHeartbeat`/`stopHeartbeat` into `services/timer.ts` (CRASH-01)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md — `checkResume()` test coverage (`services/checkResume.test.ts` × 4) + powerMonitor test (`services/powerMonitor.test.ts` × 2) + `runMain()` boot-order edit: register `powerMonitor.on('resume')` + invoke `checkResume()` BEFORE `registerAllHandlers()` + `createWindow()` per D-14 (CRASH-02, CRASH-03, CRASH-04)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-05-PLAN.md — IPC surface fill-out: `src/shared/ipc.ts` adds `ResumeResultDto` + `checkResume`; `src/shared/contracts/timeEntries.ts` adds `CheckResumeArgsSchema`; new `src/main/ipc/timeEntries.ts` with 6 Zod-validated handlers (all delegating to TimerService — TIME-07 enforced by grep gate); `src/main/ipc/index.ts` wires `registerTimeEntriesHandlers`; `src/preload/index.ts` replaces 5 `notImpl` stubs with `invokeWrapped` + adds `checkResume` (TIME-07, CRASH-03, CRASH-04)

---

### Phase 3: Frameless Window + Settings

**Goal**: Users can see and interact with the app's frameless floating window, drag it, and persist settings choices — so the timer table has a correct shell to live inside
**Depends on**: Phase 1
**Requirements**: WIN-01, WIN-02, WIN-03, WIN-04, WIN-05, WIN-06, WIN-07, SET-01, SET-02, SET-03, SET-04, SET-05
**Success Criteria** (what must be TRUE):

  1. User can drag the app window to a new position by clicking and dragging the title bar area
  2. App window stays above other application windows after switching focus away and back
  3. Window position and size after manual resize or drag are restored exactly on the next app launch
  4. User can open the Settings dialog via the gear icon in the title bar; dialog renders as a modal overlay
  5. User can choose week start (Monday or Sunday), click OK, quit, relaunch, and see the same choice still selected

**Plans**: 6 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Migration 002 + SettingKey contract drift (drop legacy window.\* + add settings.window_geometry composite key + Zod discriminatedUnion SetArgsSchema + CloseWindowArgsSchema) (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 03-02-PLAN.md — window-geometry service (readSavedBounds + clamp + debounced 250 ms write + flushPendingWrite + attachListeners + resetForTests) + ≥ 5 vitest cases (Wave 2, autonomous)
- [x] 03-03-PLAN.md — Settings IPC handlers (settings.get/set/list) + service-bypass exception (D-28) + preload bridge real invokeWrapped + ≥ 4 vitest cases (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 03-04-PLAN.md — Main entry (createWindow frameless + alwaysOnTop + minSize + backgroundColor #181b21 + macOS 'floating' branch + runMain boot order readSavedBounds→registerAllHandlers→createWindow(bounds)→attachListeners) + system.closeWindow handler + preload + WIN-01/02/04/05/07 tests (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3)*

- [x] 03-05-PLAN.md — Renderer chrome: tokens.css + globals.css + TitleBar (drag region + gear + close inline SVGs) + SettingsDialog (native <dialog> + form + radios + OK/Cancel/Apply) + SettingsContext + App composition root + UI-SPEC A-01..A-12 anti-pattern grep gates (Wave 4, autonomous)

**Wave 5** *(blocked on Wave 4)*

- [ ] 03-06-PLAN.md — Manual ROADMAP UAT checkpoint (operator runs npm run dev:no-sandbox; verifies 5 ROADMAP criteria; authors 03-HUMAN-UAT.md) (Wave 5, autonomous: false — D-29 manual-only)

**UI hint**: yes

---

### Phase 4: Timer Table + Live Duration

**Goal**: Users can view, start, stop, add, and delete timers in a live table where the running timer'''s duration updates every second
**Depends on**: Phase 2, Phase 3
**Requirements**: TIME-01, TIME-02, TIME-04, TIME-05, FIELD-01, FIELD-02, FIELD-03
**Success Criteria** (what must be TRUE):

  1. Clicking the start button on a timer row starts it and shows the duration ticking up every second in `HH:MM:SS` monospace format
  2. Clicking the start button on a second timer stops the first and starts the second (single-active-timer enforced visibly)
  3. Clicking the stop button on the running timer stops it; duration display freezes
  4. User can add a new timer row via the Add Timer button; the new row appears with an empty description focused for editing
  5. User can delete a timer row via the delete button after confirming in a modal; the row disappears without page reload
  6. Editing a timer description in-place and pressing Enter or clicking away saves the change (visible without refresh)

**Plans**: 9 plans
Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Wave 0 infra: install 7 deps (TanStack Table/Query/Zustand + jsdom + Testing Library) + vitest.renderer.config.ts + setup + test-utils (mock-api + render-with-providers); HUMAN-VERIFY package-legitimacy checkpoint; D-35 React 18.3 pin (Wave 1, autonomous: false)
- [x] 04-02-PLAN.md — Shared types: Timer.totalSeconds + Timer.running additions; TickEventPayload + TickApi + ElectronApi.tick; src/shared/contracts/tick.ts Zod schema (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 04-03-PLAN.md — Main repo: fill 4 stubbed setters (delete/setProject/setOffset/setNotes) + rewrite list() with LEFT JOIN GROUP BY for totalSeconds + running; D-22 dateRange ignored Phase 4; ≥ 6 new vitest cases (Wave 2, autonomous)
- [x] 04-04-PLAN.md — Main services: tick.ts (interval lifecycle + emit + emitNow) with ≥ 4 cases; TimerService.deleteTimer wrapper + tickService.start/stop hooks at TimerService.start/stopActive with ≥ 3 cases; powerMonitor.test.ts call-order assertion (checkResume BEFORE emitNow) ≥ 1 new case (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 04-05-PLAN.md — Main IPC + preload: src/main/ipc/timers.ts with 7 Zod-validated handlers + service-bypass header (D-28) + lone D-17 delete exception + D-18 create-returns-Timer with ≥ 9 cases; registerTimersHandlers wired in ipc/index.ts; preload replaces 7 notImpl stubs with real invokeWrapped + adds tick.subscribe with cleanup return + ≥ 8 cases; powerMonitor.on('''resume''') extension calls tickService.emitNow (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3)*

- [x] 04-06-PLAN.md — Renderer infra: tokens.css extension (3-4 new tokens, no Phase 3 redefines per A-15); format-duration utility + ≥ 4 cases; 3 Zustand stores (tick/confirmDelete/pendingFocus); 6 TanStack Query hooks; TickBridge component + ≥ 2 cases; main.tsx wraps App with QueryClientProvider; D-32 coverage scope (Wave 4, autonomous)

**Wave 5** *(blocked on Wave 4)*

- [x] 04-07-PLAN.md — Renderer chrome: ConfirmDialog + module CSS + 4 cases; AddTimerButton + module CSS; StartStopCell (D-26 Option B) + module CSS + 2 cases; DeleteCell + module CSS + 1 case; A-13 partial gate + A-01 + A-02 pass; D-23/D-24/D-26/D-27/D-32 cited (Wave 5, autonomous)

**Wave 6** *(blocked on Wave 5)*

- [x] 04-08-PLAN.md — Renderer editable cells + table host + App composition: DescriptionCell (swap-to-input + Enter/Escape + queueMicrotask focus) + module CSS + 3 cases; DurationCell (LONE useTickStore subscriber + React.memo) + module CSS; TimerTable (TanStack Table v8 headless + 7 cols in D-04 order + D-05 getRowId) + module CSS + 3 cases + barrel; App.tsx mounts TickBridge + ConfirmDialog + AddTimerButton + TimerTable; App.module.css extends .main + .toolbar + .tableWrap; FULL A-13/A-14/A-16 grep gates pass (Wave 6, autonomous)

**Wave 7** *(blocked on Wave 6)*

- [x] 04-09-PLAN.md — Manual ROADMAP UAT checkpoint (operator runs npm run dev:no-sandbox; verifies 6 ROADMAP criteria + 4 manual-only verifications; authors 04-HUMAN-UAT.md) (Wave 7, autonomous: false)

**UI hint**: yes

---

### Phase 5: Project Combobox + Field Editors

**Goal**: Users can assign projects to timers via type-ahead autocomplete, create new projects, and edit timestamps, duration offsets, and notes inline
**Depends on**: Phase 4
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04, PROJ-05, FIELD-04, FIELD-05, FIELD-06
**Success Criteria** (what must be TRUE):

  1. Typing part of a project name in the project combobox filters the dropdown to matching items (case-insensitive substring)
  2. Typing a name that does not match any project and pressing Enter creates the project and selects it for that timer row
  3. User can open the timestamp editor popup from the duration column and change a timer's start or end timestamp; the duration display updates after save
  4. User can set a duration offset (minutes) inside the timestamp popup; the elapsed time calculation reflects the offset immediately
  5. User can add notes to a timer inside the popup; notes persist after closing and reopening the popup
  6. Project list (including any newly created projects) is present after app restart

**Plans**: 8 plans
Plans:
**Wave 1**

- [x] 05-00-PLAN.md — Install cmdk@1.1.1 (package-legitimacy human checkpoint) (Wave 1, autonomous: false)
- [x] 05-01-PLAN.md — projects.* IPC layer: new ipc/projects.ts (3 handlers) + register + preload bridges + tests (PROJ-01/04/05) (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 05-02-PLAN.md — timeEntries timestamp editing: setStart/setEnd repo+contracts+IPC+preload+guards (D-08/D-09) + tests (FIELD-04) (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 05-03-PLAN.md — Renderer data layer: epoch-datetime util + useTimestampDialogStore + 9 TanStack Query hooks + mock-api (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3)*

- [x] 05-04-PLAN.md — ProjectCell (cmdk type-ahead) + ProjectNumberCell + 3 tokens + tests (PROJ-01/02/03/04) (Wave 4, autonomous)
- [x] 05-05-PLAN.md — TimestampEditorDialog (entries/offset/notes, auto-save on blur) + tests (FIELD-04/05/06) (Wave 4, autonomous)

**Wave 5** *(blocked on Wave 4)*

- [x] 05-06-PLAN.md — TimerTable 6-column reconciliation + DurationCell popup trigger + App mount + anti-pattern gates (D-05/D-06) (Wave 5, autonomous)

**Wave 6** *(blocked on Wave 5)*

- [x] 05-07-PLAN.md — Manual ROADMAP UAT checkpoint (6 criteria + PROJ-05 restart) (Wave 6, autonomous: false)

**UI hint**: yes

---

### Phase 6: Date Navigation + Calendar Picker

**Goal**: Users can navigate between days and see daily and weekly totals that update live, with week start applied from settings
**Depends on**: Phase 3, Phase 4
**Requirements**: DATE-01, DATE-02, DATE-03, DATE-04, DATE-05, DATE-06, DATE-07, DATE-08
**Success Criteria** (what must be TRUE):

  1. Clicking the prev-arrow and next-arrow buttons changes the displayed date and reloads only timers for that day
  2. Clicking the today button always returns to the current calendar date regardless of which day was previously shown
  3. User can open a calendar picker, select an arbitrary date, and the timer table refreshes to show timers for that date
  4. Daily total shows the correct sum of all timer durations for the selected day in `HH:MM:SS` format
  5. Weekly total reflects the correct 7-day range with the week boundary matching the week-start setting (Monday or Sunday) chosen in Settings
  6. Daily and weekly totals update every second while a timer is running (live tick visible without user action)

**Plans**: 8 plans
Plans:
**Wave 1**

- [x] 06-00-PLAN.md — Package-legitimacy human checkpoint + install react-day-picker@8.10.2 --save-exact (no date-fns) (Wave 1, autonomous: false)
- [x] 06-01-PLAN.md — Main: timers repo filteredList WHERE (created_at half-open range) + handleList dateRange pass-through + repo/IPC tests (Wave 1, autonomous)
- [x] 06-02-PLAN.md — Renderer data layer: useSelectedDateStore + useCalendarPickerStore + date-ranges util (dayRangeOf/weekRangeOf) + store/util unit tests (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 06-03-PLAN.md — useDateTimers hooks (useDayTimers/useWeekTimers, ['timers',{from,to}] keys) + switch TimerTable to day-scoped query + prefix-invalidation test (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 06-04-PLAN.md — DateNavToolbar (prev/Today/next + label + cal button) + DailyTotal/WeeklyTotal live readouts + --shadow-calendar token + totals-computation test (Wave 3, autonomous)
- [x] 06-05-PLAN.md — CalendarPickerDialog (react-day-picker single mode in native <dialog>, dark-theme rdp overrides, week-start mapping) (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3)*

- [x] 06-06-PLAN.md — App.tsx integration: mount DateNavToolbar (first child of <main>) + CalendarPickerDialog (App-scope sibling) (Wave 4, autonomous)

**Wave 5** *(blocked on Wave 4)*

- [x] 06-07-PLAN.md — Manual ROADMAP UAT checkpoint (6 criteria + DATE-04/07/08 manual-only behaviors) (Wave 5, autonomous: false)

**UI hint**: yes

---

### Phase 7: Packaging + E2E Hardening

**Goal**: The app can be distributed as a working Windows NSIS installer and Linux AppImage, with an E2E test suite confirming all critical user flows run headlessly
**Depends on**: Phase 5, Phase 6
**Requirements**: PKG-03, PKG-05, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):

  1. `npm run build` produces a Windows NSIS installer + portable exe (owner request 2026-06-04) and a Linux AppImage without errors; the packaged binary opens the DB successfully (no ABI/ASAR failure)
  2. App icon and `productName` appear correctly in the built installer and window title bar
  3. Playwright E2E suite runs headlessly via `xvfb-run` on Linux CI and passes all critical-path tests: start/stop timer, single-active-timer invariant, description in-place edit, project type-ahead, settings persist across restart, crash-recovery resume
  4. The TS test suite achieves behavior parity with v1 — every feature tested in `tests/test_*` has a TypeScript counterpart in Vitest or Playwright

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 07-01-PLAN.md — Package-legitimacy human checkpoint + install @playwright/test 1.60.x --save-exact (Wave 1, autonomous: false)
- [x] 07-02-PLAN.md — Packaging hardening: electron-builder.yml productName Timerz + icons + maximum compression + buildResources; generate build/icon.png+ico; fix smoke-packaged.ts Timerz.exe path; build AppImage + smoke (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 07-03-PLAN.md — E2E infra: TIMERZ_USERDATA seam in database.ts + unit test; data-testid selector audit; playwright.config.ts + e2e/fixtures.ts + test:e2e script (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 07-04-PLAN.md — E2E suite: timer-lifecycle + field-editing + settings-persist + crash-recovery specs (7 gaps closed) (Wave 3, autonomous)

**Wave 4** *(blocked on Wave 3)*

- [x] 07-05-PLAN.md — CI extension: Linux xvfb-run E2E step + AppImage/NSIS artifact upload (Wave 4, autonomous)
- [x] 07-06-PLAN.md — v1->v2 parity matrix 07-PARITY-MATRIX.md (TEST-03 verifiable artifact + cleanup gate) (Wave 4, autonomous)

**Wave 5** *(blocked on Wave 4)*

- [x] 07-07-PLAN.md — v1 Python tree removal (gated on parity matrix, dedicated commit) (Wave 5, autonomous: false)

---

### Phase 8: Projects Management + App Footer

**Goal**: Users can manage their projects (view, create, edit, delete) through a popup opened from a footer below the timer table, and see the app version in that footer which opens the GitHub releases page in their default browser
**Depends on**: Phase 5 (project data layer), Phase 4 (timer table shell)
**Requirements**: (post-v2.0 enhancement — requirements TBD during discussion/planning)
**Success Criteria** (what must be TRUE):

  1. A footer is visible below the timer table with a projects link on the left and the app version on the right
  2. Clicking the footer projects link opens a projects management popup
  3. User can view the list of existing projects in the popup
  4. User can create, edit, and delete projects from the popup; changes persist across restart
  5. Clicking the version number on the right opens the GitHub releases page in the user's default browser

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 08-01-PLAN.md — Backend IPC surface: projects repo (updateName/remove/countTimerRefs + name-uniqueness guard) + projects.* handlers + system.getVersion + system.openReleases (URL hardcoded) + contracts + preload bridges + tests (Wave 1, autonomous)

**Wave 2** *(blocked on Wave 1)*

- [x] 08-02-PLAN.md — Renderer building blocks: useAppVersion/useUpdateProjectName/useDeleteProject hooks + useConfirmDeleteProjectStore + AppFooter component (Projects link + version→releases, SC-1/SC-5) (Wave 2, autonomous)

**Wave 3** *(blocked on Wave 2)*

- [x] 08-03-PLAN.md — ProjectsDialog (native <dialog>: list/inline-edit/add/count-aware delete-confirm, SC-2/SC-3/SC-4) + App.tsx mount of footer + dialog (Wave 3, autonomous)

**UI hint**: yes

---

## Completed Milestones

<details>
<summary>✅ v1.0 MVP (Phases 1–2) — SHIPPED 2026-02-25</summary>

**Phases:**

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-02-25
- [x] Phase 2: Core UI (6/6 plans) — completed 2026-02-25

**Summary:**
Established complete local-first timer engine with SQLite persistence, single-active-timer FSM, crash recovery detection via heartbeat, and Qt-material main window with full timer management (create, start/stop, edit timestamps, add notes, date range filtering with daily/weekly totals).

**See:** [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) for full details, decisions, and technical debt.

</details>

<details>
<summary>✅ v1.1 Phase 3: Settings Foundation — SHIPPED 2026-03-22</summary>

**Phase:**

- [x] Phase 3: Settings Foundation (2/2 plans) — completed 2026-03-22

**Summary:**
Delivered SettingsService persistence layer (typed QSettings wrapper), gear icon in TitleBarWidget, SettingsDialog with General tab (week-start preference), OK/Cancel/Apply wiring, and 10+6 tests. Week start now configurable and persists across restarts.

**Plans completed:**

- 03-01-PLAN.md — SettingsService persistence layer + settings gear icon
- 03-02-PLAN.md — SettingsDialog UI + wire into MainWindow title bar

</details>

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 5/5 | Complete   | 2026-06-01 |
| 2. Core UI | v1.0 | 5/5 | Complete   | 2026-06-01 |
| 3. Settings Foundation | v1.1 | 5/6 | In Progress|  |
| 1. Foundation | v2.0 | 0/5 | Planned | — |
| 2. Timer Service FSM + Crash Recovery | v2.0 | 0/5 | Planned | — |
| 3. Frameless Window + Settings | v2.0 | 0/? | Not started | — |
| 4. Timer Table + Live Duration | v2.0 | 9/9 | Complete   | 2026-06-02 |
| 5. Project Combobox + Field Editors | v2.0 | 8/8 | Complete   | 2026-06-04 |
| 6. Date Navigation + Calendar Picker | v2.0 | 8/8 | Complete   | 2026-06-04 |
| 7. Packaging + E2E Hardening | v2.0 | 7/7 | Complete    | 2026-06-04 |
| 8. Projects Management + App Footer | v2.0 | 3/3 | Complete   | 2026-06-08 |

---

## Coverage Summary

**v2.0 Requirements:** 56
**Requirements Mapped:** 56/56 ✓

### Requirement-to-Phase Mapping

| Requirement | Phase | Category |
|-------------|-------|----------|
| DATA-01 | 1 | Data Layer |
| DATA-02 | 1 | Data Layer |
| DATA-03 | 1 | Data Layer |
| DATA-04 | 1 | Data Layer |
| DATA-05 | 1 | Data Layer |
| DATA-06 | 1 | Data Layer |
| PKG-01 | 1 | Packaging & Build |
| PKG-02 | 1 | Packaging & Build |
| PKG-04 | 1 | Packaging & Build |
| TEST-01 | 1 | Test Coverage |
| TIME-03 | 2 | Timer Engine |
| TIME-06 | 2 | Timer Engine |
| TIME-07 | 2 | Timer Engine |
| CRASH-01 | 2 | Crash Recovery |
| CRASH-02 | 2 | Crash Recovery |
| CRASH-03 | 2 | Crash Recovery |
| CRASH-04 | 2 | Crash Recovery |
| WIN-01 | 3 | Window / UI Shell |
| WIN-02 | 3 | Window / UI Shell |
| WIN-03 | 3 | Window / UI Shell |
| WIN-04 | 3 | Window / UI Shell |
| WIN-05 | 3 | Window / UI Shell |
| WIN-06 | 3 | Window / UI Shell |
| WIN-07 | 3 | Window / UI Shell |
| SET-01 | 3 | Settings |
| SET-02 | 3 | Settings |
| SET-03 | 3 | Settings |
| SET-04 | 3 | Settings |
| SET-05 | 3 | Settings |
| TIME-01 | 4 | Timer Engine |
| TIME-02 | 4 | Timer Engine |
| TIME-04 | 4 | Timer Engine |
| TIME-05 | 4 | Timer Engine |
| FIELD-01 | 4 | Field Editing |
| FIELD-02 | 4 | Field Editing |
| FIELD-03 | 4 | Field Editing |
| PROJ-01 | 5 | Project Management |
| PROJ-02 | 5 | Project Management |
| PROJ-03 | 5 | Project Management |
| PROJ-04 | 5 | Project Management |
| PROJ-05 | 5 | Project Management |
| FIELD-04 | 5 | Field Editing |
| FIELD-05 | 5 | Field Editing |
| FIELD-06 | 5 | Field Editing |
| DATE-01 | 6 | Date Navigation |
| DATE-02 | 6 | Date Navigation |
| DATE-03 | 6 | Date Navigation |
| DATE-04 | 6 | Date Navigation |
| DATE-05 | 6 | Date Navigation |
| DATE-06 | 6 | Date Navigation |
| DATE-07 | 6 | Date Navigation |
| DATE-08 | 6 | Date Navigation |
| PKG-03 | 7 | Packaging & Build |
| PKG-05 | 7 | Packaging & Build |
| TEST-02 | 7 | Test Coverage |
| TEST-03 | 7 | Test Coverage |

---

*Roadmap updated 2026-06-01 — Phase 2 planned (5 plans, 5 waves)*
