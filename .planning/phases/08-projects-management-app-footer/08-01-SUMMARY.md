---
phase: 08-projects-management-app-footer
plan: 01
subsystem: api
tags: [electron, ipc, sqlite, better-sqlite3, zod, typescript]

requires:
  - phase: 07-packaging-e2e-hardening
    provides: "fully packaged Electron app with IPC surface for system/settings/timers"

provides:
  - "projects.updateName IPC channel: rename project with uniqueness guard (ValidationError on duplicate)"
  - "projects.delete IPC channel: delete project (FK ON DELETE SET NULL unassigns timers, timers survive)"
  - "projects.countTimerRefs IPC channel: count timers referencing a project (for confirm dialog)"
  - "system.getVersion IPC channel: returns running app version from app.getVersion()"
  - "system.openReleases IPC channel: opens hardcoded GitHub releases URL via shell.openExternal (A-03 gate)"
  - "All 5 new channels bridged in preload/index.ts"
  - "ProjectsApi and SystemApi interfaces extended in shared/ipc.ts"

affects:
  - 08-02 (ProjectsDialog renderer)
  - 08-03 (AppFooter renderer)
  - any renderer plan consuming window.api.projects.* or window.api.system.*

tech-stack:
  added: []
  patterns:
    - "Repo uniqueness guard: SELECT before UPDATE pattern (nameExists prepared statement)"
    - "handler() factory + Zod schema for all new IPC handlers"
    - "No-arg schema z.object({}).optional() for system.getVersion and system.openReleases"
    - "RELEASES_URL module-level constant in system.ts — never accept URL from renderer"
    - "TDD: RED (test commit) -> GREEN (feat commit) per task"

key-files:
  created:
    - "src/main/db/repositories/projects.ts — +updateName, +remove, +countTimerRefs, +nameExists stmt"
  modified:
    - "src/main/db/repositories/projects.test.ts — +9 test cases for new repo functions"
    - "src/main/ipc/projects.ts — +handleUpdateName, +handleDelete, +handleCountTimerRefs, +3 registrations"
    - "src/main/ipc/projects.test.ts — +5 test cases for new IPC handlers"
    - "src/main/ipc/system.ts — +handleGetVersion, +handleOpenReleases, +2 registrations, +app+shell imports, +RELEASES_URL"
    - "src/main/ipc/system.test.ts — +3 test cases for getVersion and openReleases, updated electron mock"
    - "src/shared/contracts/projects.ts — +UpdateNameArgsSchema, +DeleteProjectArgsSchema, +CountTimerRefsArgsSchema"
    - "src/shared/contracts/system.ts — +GetVersionArgsSchema, +OpenReleasesArgsSchema"
    - "src/shared/ipc.ts — ProjectsApi +updateName/delete/countTimerRefs, SystemApi +getVersion/openReleases"
    - "src/preload/index.ts — projects namespace +3 bridges, system namespace +2 bridges"

key-decisions:
  - "D-01: remove() uses plain DELETE — FK ON DELETE SET NULL + PRAGMA foreign_keys = ON handles timer unassignment automatically (no explicit UPDATE needed)"
  - "D-02: countTimerRefs() is a separate repo function + IPC channel to give renderer fresh count at delete time"
  - "D-07: system.getVersion sources from app.getVersion() in main (renderer cannot access app module)"
  - "D-08: system.openReleases hardcodes RELEASES_URL constant in main — renderer passes no URL (open-redirect mitigation, gate A-03 verified)"
  - "Uniqueness guard for updateName: SELECT nameExists before UPDATE; throw ValidationError on match (projects table has no UNIQUE constraint on project_name)"

patterns-established:
  - "Pattern: module-level RELEASES_URL constant + no-arg handler body for security-sensitive shell.openExternal"
  - "Pattern: nameExists prepared statement (SELECT id WHERE name = ? AND id != ?) for soft uniqueness enforcement"

requirements-completed: [SC-3, SC-4, SC-5]

duration: 15min
completed: 2026-06-08
---

# Phase 8 Plan 01: IPC Contract for Projects CRUD + App Version/Releases Summary

**5 new IPC channels (projects.updateName/delete/countTimerRefs + system.getVersion/openReleases) wired end-to-end from SQLite repo through Zod-validated handlers to preload bridges, with URL hardcoded in main for open-redirect mitigation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-08T08:46:00Z
- **Completed:** 2026-06-08T08:56:00Z
- **Tasks:** 3 (each TDD: RED commit + GREEN commit)
- **Files modified:** 9

## Accomplishments

- Extended projects repository with `updateName` (uniqueness guard via `nameExists` SELECT), `remove` (FK cascade unassigns timers automatically), and `countTimerRefs` (COUNT for confirm dialog)
- Added `handleUpdateName`, `handleDelete`, `handleCountTimerRefs` IPC handlers with Zod validation + registered in `registerProjectsHandlers`
- Added `handleGetVersion` (app.getVersion()) and `handleOpenReleases` (RELEASES_URL hardcoded, gate A-03 confirmed: 0 occurrences of `shell.openExternal(args` in code)
- All 5 new channels bridged in preload; `ProjectsApi` and `SystemApi` extended in shared types
- Full test suite: 168 tests green (22 test files)

## Task Commits

Each task was committed atomically with TDD RED then GREEN phases:

1. **Task 1 RED: projects repo failing tests** - `8f36f98` (test)
2. **Task 1 GREEN: projects repo updateName/remove/countTimerRefs** - `cef5adf` (feat)
3. **Task 2 RED: projects IPC handler failing tests + contracts** - `f9ee621` (test)
4. **Task 2 GREEN: projects IPC handlers + ProjectsApi types** - `4668d03` (feat)
5. **Task 3 RED: system handler failing tests + contracts** - `d4212cb` (test)
6. **Task 3 GREEN: system handlers + SystemApi + preload bridges** - `4c750c8` (feat)

## Files Created/Modified

- `src/main/db/repositories/projects.ts` — +updateName (uniqueness guard), +remove (FK cascade), +countTimerRefs; +nameExists/updateName/delete/countTimerRefs prepared statements
- `src/main/db/repositories/projects.test.ts` — +9 test cases (updateName persist/NotFound/ValidationError, remove cascade/NotFound, countTimerRefs 0/N/unknown)
- `src/main/ipc/projects.ts` — +handleUpdateName, +handleDelete, +handleCountTimerRefs handlers; +3 channel registrations in registerProjectsHandlers
- `src/main/ipc/projects.test.ts` — +5 test cases for new handlers including Zod validation cases
- `src/main/ipc/system.ts` — +app+shell electron imports, +RELEASES_URL constant, +handleGetVersion, +handleOpenReleases; +2 channel registrations
- `src/main/ipc/system.test.ts` — +3 test cases for getVersion/openReleases; updated electron mock with app.getVersion + shell.openExternal
- `src/shared/contracts/projects.ts` — +UpdateNameArgsSchema, +DeleteProjectArgsSchema, +CountTimerRefsArgsSchema with type exports
- `src/shared/contracts/system.ts` — +GetVersionArgsSchema, +OpenReleasesArgsSchema with type exports
- `src/shared/ipc.ts` — ProjectsApi +updateName/delete/countTimerRefs; SystemApi +getVersion/openReleases
- `src/preload/index.ts` — projects namespace +updateName/delete/countTimerRefs; system namespace +getVersion/openReleases

## Decisions Made

- Used plain `DELETE FROM projects WHERE id = ?` for `remove()` — the schema's `ON DELETE SET NULL` + `PRAGMA foreign_keys = ON` (already enforced in database.ts) handles timer unassignment automatically; no explicit UPDATE needed
- Added `nameExists` prepared statement (`SELECT id FROM projects WHERE project_name = ? AND id != ?`) rather than relying on a DB UNIQUE constraint, since the projects table has no such constraint and adding one would require a migration
- Hardcoded `RELEASES_URL` as a module-level constant in `system.ts`; comment in JSDoc avoids including `shell.openExternal(args` text to keep grep gate clean

## Deviations from Plan

None - plan executed exactly as written.

**One minor adjustment:** The JSDoc comment for `handleOpenReleases` was reworded to avoid the string `shell.openExternal(args` appearing in a comment (which would have caused the security grep gate to return 1 instead of 0). The comment now reads "NEVER pass a renderer-supplied URL here" instead of referencing the specific call pattern. This is a documentation improvement with no behavior change.

## Issues Encountered

- `npm rebuild better-sqlite3 --build-from-source` fails in this environment (gyp error), but the prebuilt binary for Electron is already in place. Tests run correctly via `npx vitest run --config vitest.main.config.ts`.

## Threat Surface Scan

No new network endpoints introduced. The `system.openReleases` handler opens an external URL but the URL is hardcoded — no new trust boundary created.

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All new surface was anticipated in the plan's threat model (T-08-01 through T-08-04) |

## Next Phase Readiness

- `window.api.projects.{updateName,delete,countTimerRefs}` callable from renderer
- `window.api.system.{getVersion,openReleases}` callable from renderer
- All TypeScript types in `ElectronApi` are correct — no renderer-side type errors expected
- Phase 08-02 (ProjectsDialog) and 08-03 (AppFooter) can build against this stable contract

## Self-Check

Files exist:
- `src/main/db/repositories/projects.ts` — FOUND
- `src/main/ipc/projects.ts` — FOUND
- `src/main/ipc/system.ts` — FOUND
- `src/shared/ipc.ts` — FOUND
- `src/preload/index.ts` — FOUND

Commits exist: 8f36f98, cef5adf, f9ee621, 4668d03, d4212cb, 4c750c8 — all verified in git log

## Self-Check: PASSED

---
*Phase: 08-projects-management-app-footer*
*Completed: 2026-06-08*
