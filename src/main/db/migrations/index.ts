// src/main/db/migrations/index.ts
// Barrel for migration SQL files. Each entry is a typed { version, sql } pair.
//
// Why `?raw` imports:
//   - Vite/electron-vite does NOT auto-copy .sql files into the bundle.
//   - `fs.readFileSync('src/main/db/migrations/001_initial.sql')` works in
//     dev (filesystem still has the source tree) but FAILS in the packaged
//     asar (the path doesn't exist post-build).
//   - `?raw` tells Vite to inline the file's contents as a string AT BUILD
//     TIME — works identically in dev and packaged builds.
//
// See RESEARCH.md §3 lines ~597-609 + CONTEXT.md "Specific Ideas" — partial-
// apply must be impossible. The MIGRATIONS array is consumed by `migrate.ts`
// in `runMigrations()`; each entry runs in its own transaction with the
// `user_version` bump in the same transaction.

import init001 from './001_initial.sql?raw'
import init002 from './002_window_geometry.sql?raw'

export const MIGRATIONS = [
  { version: 1, sql: init001 },
  // Phase 3 — composite settings.window_geometry seed row. Replaces the
  // never-seeded legacy window.x|y|width|height stubs (D-09).
  { version: 2, sql: init002 },
] as const
