# Timerz v2.0 Requirements

**Defined:** 2026-05-29
**Core Value:** Low-friction multi-timer management that gets used daily

## Milestone v2.0: Electron Rewrite

**Goal:** Replace PySide6/Python implementation with Electron + TypeScript/Node at full behavior parity with v1.0 + Phase 3. Drop Python entirely. Local-only single-user.

**Scope rule:** v2.0 is a parity port. Every requirement maps to an existing v1 behavior. NO new user-facing features. Anti-features (tray, auto-launch, theme toggle, clipboard, additional settings) explicitly deferred.

---

## v2.0 Requirements

REQ-ID format: `[CATEGORY]-[NUMBER]` aligned with research categories. New IDs (not continuing v1 numbering) since this is a clean rewrite in a different stack.

### WIN — Window / UI Shell

- [ ] **WIN-01**: App opens as a frameless `BrowserWindow` (no native title bar, no menu bar) on launch
- [ ] **WIN-02**: App window stays always-on-top across platforms (macOS uses `'floating'` level; Windows/Linux use default)
- [ ] **WIN-03**: User can drag the window by clicking and dragging the custom title bar (CSS `-webkit-app-region: drag`)
- [ ] **WIN-04**: User can close the window via custom close button in the title bar
- [ ] **WIN-05**: User can resize the window by dragging window edges; minimum size 500×350, default 800×600
- [ ] **WIN-06**: Window position and size persist across app restarts (clamped to visible screen area)
- [ ] **WIN-07**: Dark theme aesthetic renders consistently across the app via native CSS custom properties (no qt-material equivalent dependency)

### TIME — Timer Engine

- [ ] **TIME-01**: User can start a timer by clicking the start button on a timer row
- [ ] **TIME-02**: User can stop the running timer by clicking the stop button on its row
- [ ] **TIME-03**: Starting a timer while another is running automatically stops the running one (single-active-timer invariant)
- [ ] **TIME-04**: Running timer's duration column updates every second in `HH:MM:SS` monospace format
- [ ] **TIME-05**: User can add a new timer row via an "Add Timer" button
- [ ] **TIME-06**: Timer duration is computed from wall-clock epoch arithmetic (`now - start + offset`), never an in-memory counter
- [ ] **TIME-07**: All timer state transitions are mediated by a `TimerService` running in the Electron main process

### PROJ — Project Management

- [x] **PROJ-01**: User can pick a project for a timer row from a type-ahead combobox dropdown
- [x] **PROJ-02**: Combobox filters by case-insensitive substring match on each keystroke
- [x] **PROJ-03**: User can create a new project by typing an unmatched name and pressing Enter (creates project, selects it for the row)
- [x] **PROJ-04**: User can edit a project's number (billing code) inline in its column
- [x] **PROJ-05**: Project list survives app restart (persisted to SQLite)

### FIELD — Field Editing

- [ ] **FIELD-01**: User can edit a timer's description in-place by clicking the description cell (contenteditable / input)
- [ ] **FIELD-02**: Description edits auto-save on blur or Enter via IPC
- [ ] **FIELD-03**: User can delete a timer row via the delete button on its row, with a confirmation modal
- [x] **FIELD-04**: User can open a timestamp editor popup dialog from the duration column to edit start/end timestamps
- [x] **FIELD-05**: User can set a persistent duration offset (in minutes/hours) inside the timestamp popup; offset applies to elapsed calculation
- [x] **FIELD-06**: User can add notes to a timer (textarea inside the timestamp popup or row expand panel); notes auto-save on blur

### DATE — Date Navigation

- [x] **DATE-01**: User can navigate to the previous day with a prev-arrow button
- [x] **DATE-02**: User can navigate to the next day with a next-arrow button
- [x] **DATE-03**: User can jump to today with a "today" button
- [x] **DATE-04**: User can open a calendar dialog picker to select an arbitrary date or date range
- [x] **DATE-05**: Daily total displays the sum of elapsed seconds across all timers for the selected day, formatted `HH:MM:SS`
- [x] **DATE-06**: Weekly total displays the sum of elapsed seconds across the selected day's week
- [x] **DATE-07**: Week start (Monday or Sunday) is read from settings and applied to weekly total calculation
- [x] **DATE-08**: Daily and weekly totals update live every second while a timer is running

### SET — Settings

- [ ] **SET-01**: User can open the Settings dialog via a gear icon in the title bar (no-drag region)
- [ ] **SET-02**: Settings dialog renders as a modal `<dialog>` overlay (in-renderer, not a separate BrowserWindow)
- [ ] **SET-03**: Settings dialog has OK / Cancel / Apply buttons; OK and Apply persist, Cancel discards in-flight changes
- [ ] **SET-04**: User can choose week start (Monday or Sunday) in Settings
- [ ] **SET-05**: All settings persist across app restarts (stored in the SQLite `settings` table, NOT electron-store)

### DATA — Data Layer

- [ ] **DATA-01**: App uses `better-sqlite3` in the main process; renderer never accesses SQLite directly
- [ ] **DATA-02**: All renderer↔main DB interactions go through typed `ipcMain.handle` channels exposed via `contextBridge` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- [ ] **DATA-03**: SQLite database opens with `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`
- [ ] **DATA-04**: All timestamps stored as Unix epoch seconds (`INTEGER` columns); a shared `EpochSeconds` type alias and `nowSeconds()` utility prevent JS millisecond confusion
- [ ] **DATA-05**: Database lives at `path.join(app.getPath('userData'), 'timerz.db')` (never inside the app bundle)
- [ ] **DATA-06**: Schema covers `projects`, `timers`, `time_entries`, `heartbeat`, `settings` tables with foreign keys mirroring v1 schema semantics

### CRASH — Crash Recovery

- [ ] **CRASH-01**: Main process writes a heartbeat row every 60 seconds via `setInterval`
- [ ] **CRASH-02**: Heartbeat interval is reset on `powerMonitor.on('resume')` after system sleep/wake (prevents stale-timer false positives)
- [ ] **CRASH-03**: On app launch, a `TimeEntry` with `end_timestamp IS NULL` is detected and presented as the running timer (resume)
- [ ] **CRASH-04**: On app launch, if a heartbeat is stale (delta > 300s) AND a running entry exists, the app records a crash-suspect flag in main (UI surface deferred to v2.1)

### PKG — Packaging & Build

- [ ] **PKG-01**: `electron-vite 5` is wired as the build tool with separate main / preload / renderer entry points
- [ ] **PKG-02**: `@electron/rebuild` runs via `postinstall` so `better-sqlite3` is rebuilt against the target Electron ABI on every install
- [x] **PKG-03**: `electron-builder` produces Windows (NSIS installer **and** portable single-exe — owner request 2026-06-04) and Linux (AppImage) packages; native `.node` modules are listed in `asarUnpack`
- [ ] **PKG-04**: A packaged-binary smoke test (open DB, insert row, read row) runs in CI to catch ABI/ASAR breakage early
- [x] **PKG-05**: App icon and `productName` are configured in `electron-builder` config

### TEST — Test Coverage

- [ ] **TEST-01**: Vitest is wired for main-process unit tests (TimerService FSM, repositories, IPC handlers, EpochSeconds helpers)
- [x] **TEST-02**: Playwright with `xvfb-run` is wired for headless Electron E2E tests covering: start/stop, single-active-timer, in-place description edit, project type-ahead, settings persist, crash-recovery resume
- [x] **TEST-03**: Coverage at parity with v1 — every behavior in `tests/test_*` has a TS counterpart

---

## Future Requirements (deferred from v1.1 — re-evaluate post-v2)

### Widget Modes
- **WIDGET-FUT-01** (was WIDGET-02): System tray icon — requires icon asset pipeline + per-platform tray menu
- **WIDGET-FUT-02** (was WIDGET-03): Standard windowed mode (resizable, taskbar, no always-on-top)
- **WIDGET-FUT-03** (was WIDGET-04): Switch between floating / windowed / tray modes via settings without restart

### System Startup
- **START-FUT-01** (was START-01): Auto-launch on system startup (login items / Windows registry / `.desktop` autostart)
- **START-FUT-02** (was START-03): Restore last selected widget mode on startup
- **START-FUT-03** (was START-04): Restore last active timer and selected project on startup
- **CRASH-FUT-01** (was START-02): Crash recovery UI surface — banner or dialog when crash-suspect flag is set

### Settings
- **SET-FUT-01** (was SET-02): Widget mode selection in settings
- **SET-FUT-02** (was SET-03): Auto-launch toggle in settings
- **SET-FUT-03** (was SET-04): Dark/light theme toggle in settings
- **SET-FUT-04** (was SET-06): Auto-pause on app close toggle in settings

### Clipboard
- **CLIP-FUT-01** (was CLIP-02): Copy timer description to clipboard from context menu
- **CLIP-FUT-02** (was CLIP-04): Copy timer duration (`HH:MM:SS`) to clipboard from context menu

### Other deferred
- Auto-updater (electron-updater)
- Global keyboard shortcuts
- Export/import settings backup
- Custom color theme editor

---

## Out of Scope (explicit exclusions)

| Feature | Reason |
|---------|--------|
| Multi-user profiles | Requires server architecture; v2 stays local-only single-user per PROJECT.md confirmation |
| Cloud sync of timers or settings | Stays local-first by design |
| Web / Docker deployment | v2 is desktop-only Electron; no server-based variant in this milestone |
| Mobile companion app | Separate initiative; not in this codebase |
| Native macOS Application Menu | Floating widget — native menu adds nothing; suppress via `Menu.setApplicationMenu(null)` |
| `@electron/remote` for renderer DB access | Deprecated; breaks security model; all DB calls go through `ipcMain.handle` |
| Synchronous IPC (`ipcRenderer.sendSync`) | Blocks renderer; all IPC is async via `ipcRenderer.invoke` |
| Transparent BrowserWindow | Cannot be resized via OS handles; conflicts with WIN-05 |
| `electron-store` for settings | Unmaintained, creates split-brain with SQLite; settings live in SQLite `settings` table instead |
| Saving SQLite inside app bundle | App dir may be read-only post-install; always use `app.getPath('userData')` |
| Migrating v1 SQLite data into v2 schema | v2 starts with a fresh DB (no migration tooling needed; user can re-import manually if desired). Re-evaluate if user requests pre-rewrite history preservation. |

---

## Traceability

Maps each requirement to phase and success criteria. Updated 2026-05-29 by roadmapper.

| REQ-ID | Category | Phase | Status |
|--------|----------|-------|--------|
| DATA-01 | Data Layer | Phase 1 | Pending |
| DATA-02 | Data Layer | Phase 1 | Pending |
| DATA-03 | Data Layer | Phase 1 | Pending |
| DATA-04 | Data Layer | Phase 1 | Pending |
| DATA-05 | Data Layer | Phase 1 | Pending |
| DATA-06 | Data Layer | Phase 1 | Pending |
| PKG-01 | Packaging & Build | Phase 1 | Pending |
| PKG-02 | Packaging & Build | Phase 1 | Pending |
| PKG-04 | Packaging & Build | Phase 1 | Pending |
| TEST-01 | Test Coverage | Phase 1 | Pending |
| TIME-03 | Timer Engine | Phase 2 | Pending |
| TIME-06 | Timer Engine | Phase 2 | Pending |
| TIME-07 | Timer Engine | Phase 2 | Pending |
| CRASH-01 | Crash Recovery | Phase 2 | Pending |
| CRASH-02 | Crash Recovery | Phase 2 | Pending |
| CRASH-03 | Crash Recovery | Phase 2 | Pending |
| CRASH-04 | Crash Recovery | Phase 2 | Pending |
| WIN-01 | Window / UI Shell | Phase 3 | Pending |
| WIN-02 | Window / UI Shell | Phase 3 | Pending |
| WIN-03 | Window / UI Shell | Phase 3 | Pending |
| WIN-04 | Window / UI Shell | Phase 3 | Pending |
| WIN-05 | Window / UI Shell | Phase 3 | Pending |
| WIN-06 | Window / UI Shell | Phase 3 | Pending |
| WIN-07 | Window / UI Shell | Phase 3 | Pending |
| SET-01 | Settings | Phase 3 | Pending |
| SET-02 | Settings | Phase 3 | Pending |
| SET-03 | Settings | Phase 3 | Pending |
| SET-04 | Settings | Phase 3 | Pending |
| SET-05 | Settings | Phase 3 | Pending |
| TIME-01 | Timer Engine | Phase 4 | Pending |
| TIME-02 | Timer Engine | Phase 4 | Pending |
| TIME-04 | Timer Engine | Phase 4 | Pending |
| TIME-05 | Timer Engine | Phase 4 | Pending |
| FIELD-01 | Field Editing | Phase 4 | Pending |
| FIELD-02 | Field Editing | Phase 4 | Pending |
| FIELD-03 | Field Editing | Phase 4 | Pending |
| PROJ-01 | Project Management | Phase 5 | Pending |
| PROJ-02 | Project Management | Phase 5 | Pending |
| PROJ-03 | Project Management | Phase 5 | Pending |
| PROJ-04 | Project Management | Phase 5 | Pending |
| PROJ-05 | Project Management | Phase 5 | Pending |
| FIELD-04 | Field Editing | Phase 5 | Pending |
| FIELD-05 | Field Editing | Phase 5 | Pending |
| FIELD-06 | Field Editing | Phase 5 | Pending |
| DATE-01 | Date Navigation | Phase 6 | Pending |
| DATE-02 | Date Navigation | Phase 6 | Pending |
| DATE-03 | Date Navigation | Phase 6 | Pending |
| DATE-04 | Date Navigation | Phase 6 | Pending |
| DATE-05 | Date Navigation | Phase 6 | Pending |
| DATE-06 | Date Navigation | Phase 6 | Pending |
| DATE-07 | Date Navigation | Phase 6 | Pending |
| DATE-08 | Date Navigation | Phase 6 | Pending |
| PKG-03 | Packaging & Build | Phase 7 | Pending |
| PKG-05 | Packaging & Build | Phase 7 | Pending |
| TEST-02 | Test Coverage | Phase 7 | Pending |
| TEST-03 | Test Coverage | Phase 7 | Pending |
