// Barrel for migration SQL files. Each entry is a typed { version, sql } pair.
//
// `?raw` imports: Vite/electron-vite does NOT auto-copy .sql files into the
// bundle. `fs.readFileSync` works in dev but fails in the packaged asar.
// `?raw` inlines the file as a string at build time — works in both.

import init001 from './001_initial.sql?raw'
import init002 from './002_window_geometry.sql?raw'
import init003 from './003_always_on_top.sql?raw'
import init004 from './004_auto_update.sql?raw'

export const MIGRATIONS = [
  { version: 1, sql: init001 },
  { version: 2, sql: init002 },
  { version: 3, sql: init003 },
  { version: 4, sql: init004 },
] as const
