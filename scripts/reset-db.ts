// scripts/reset-db.ts
// Dev helper: wipe the userData SQLite database + WAL sidecars so a fresh
// `npm run dev` boots against an empty schema. Run via `npx tsx scripts/reset-db.ts`.
//
// Computes the userData path the same way Electron's `app.getPath('userData')`
// would (without booting Electron — this is a standalone tsx script):
//   - Linux:   $XDG_CONFIG_HOME/DewTime  (defaults to ~/.config/DewTime)
//   - Windows: %APPDATA%/DewTime
//   - macOS:   ~/Library/Application Support/DewTime  (not supported in Phase 1
//              packaging targets per electron-builder.yml — throws)
//
// Phase 1 ships Win + Linux per electron-builder.yml. macOS support is a
// Phase 7 packaging concern. The throw on macOS is intentional — better to
// fail loudly than to wipe an unrelated directory.
//
// Refs:
//   - 01-04-PLAN.md Task 3 <action> (scripts/reset-db.ts)
//   - CONTEXT.md D-11 (DB path under app.getPath('userData'))
//   - electron-builder.yml (NSIS + AppImage targets — Phase 1 OS scope)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Compute the userData directory for the Electron `productName`-prefixed
 * app folder. `productName` from electron-builder.yml is "DewTime".
 */
function userDataDir(): string {
  const product = 'DewTime'
  switch (process.platform) {
    case 'linux': {
      const xdg = process.env['XDG_CONFIG_HOME']
      if (xdg && xdg.length > 0) return path.join(xdg, product)
      return path.join(os.homedir(), '.config', product)
    }
    case 'win32': {
      const appData = process.env['APPDATA']
      if (!appData) {
        throw new Error('APPDATA env var not set; cannot resolve userData on Windows')
      }
      return path.join(appData, product)
    }
    case 'darwin':
      throw new Error(
        'reset-db on macOS is not implemented in Phase 1 — packaging targets are Windows + Linux only',
      )
    default:
      throw new Error(`reset-db: unsupported platform ${process.platform}`)
  }
}

function main(): void {
  const dir = userDataDir()
  const dbFile = path.join(dir, 'timerz.db')
  // SQLite in WAL mode leaves two sidecar files alongside the main DB:
  // '<name>-wal' (the write-ahead log) and '<name>-shm' (shared memory).
  // We MUST nuke both — leaving them around against a fresh DB can corrupt
  // it on next open. better-sqlite3 docs and SQLite WAL semantics confirm.
  const sidecars = [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]

  let deleted = 0
  for (const p of sidecars) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p)
      console.log(`deleted ${p}`)
      deleted++
    }
  }
  if (deleted === 0) {
    console.log(`nothing to delete; ${dir} either does not exist or is already clean`)
  } else {
    console.log(`reset-db: removed ${deleted} file(s) from ${dir}`)
  }
}

main()
