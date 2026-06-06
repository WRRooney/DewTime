// e2e/crash-recovery.e2e.ts
// GAP-07: boot with seeded stale heartbeat + NULL end_timestamp → running timer entry
//         surfaces in the UI (crash-recovery resume detected via checkResume() at boot).
//
// D-04 seeding: before launching Electron, seed the DB directly via better-sqlite3 with
//   inline SQL. The repository functions cannot be imported here because they transitively
//   import migrations/index.ts which uses Vite-specific `?raw` import syntax that
//   Playwright's TS processor cannot compile. Inline SQL is explicitly endorsed in
//   07-RESEARCH.md Pattern 3 ("for crash-recovery seeding before launch, raw SQL is
//   acceptable since repositories need initDb() first — document this exception").
//
// The seeded heartbeat is 600s old (>> CRASH_THRESHOLD_SECONDS=300), making this a
// crash-suspect case. checkResume() at boot detects the stale entry; the timer row
// surfaces as running (end_timestamp IS NULL). The crash-banner UI is deferred
// (CRASH-FUT-01) — we assert timer presence + running state only.
//
// This test does NOT use the shared `electronApp`/`window` fixtures — it needs custom
// DB seeding before launch. The `userDataDir` fixture provides per-test tmpdir + teardown.
//
// Refs:
//   - 07-04-PLAN.md Task 2 (GAP-07, D-04)
//   - 07-PATTERNS.md § e2e/crash-recovery.e2e.ts (seeding skeleton)
//   - 07-RESEARCH.md Pattern 3 (crash-recovery seeding) + Pitfall 5 (initDb in Node)
//   - src/main/services/checkResume.test.ts lines 106-135 (exact seeding pattern)
//   - 07-RESEARCH.md § Anti-Patterns ("for crash-recovery seeding before launch, raw SQL
//     is acceptable since repositories need initDb() first — document this exception")

import { test as base, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
// Seed with Node's built-in SQLite (no native-addon ABI). better-sqlite3 can't
// be used here: the Electron app launched below needs it built for Electron's
// ABI, which is incompatible with the system-Node ABI this test process runs
// under. Requires NODE_OPTIONS=--experimental-sqlite (set by the e2e CI step).
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// CRASH_THRESHOLD_SECONDS from src/main/services/timer.ts — heartbeat age >300s → crash-suspect.
const CRASH_THRESHOLD_SECONDS = 300

// Inline schema SQL (mirrors 001_initial.sql + 002_window_geometry.sql).
// Using raw SQL because the migrate module imports Vite ?raw SQL strings which
// Playwright's TS processor cannot compile outside the electron-vite bundle.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number  TEXT,
  project_name    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  offset        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_timers_project_id ON timers(project_id);
CREATE INDEX IF NOT EXISTS idx_timers_created_at ON timers(created_at);
CREATE TABLE IF NOT EXISTS time_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id        INTEGER NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  start_timestamp INTEGER NOT NULL,
  end_timestamp   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_time_entries_timer_id ON time_entries(timer_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_timestamp ON time_entries(start_timestamp);
CREATE INDEX IF NOT EXISTS idx_time_entries_running ON time_entries(timer_id)
  WHERE end_timestamp IS NULL;
CREATE TABLE IF NOT EXISTS heartbeat (
  id              INTEGER PRIMARY KEY,
  last_beat       INTEGER NOT NULL,
  timer_entry_id  INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('settings.week_start',    '0'),
  ('settings.dark_mode',     'true'),
  ('settings.auto_pause',    'false'),
  ('settings.widget_mode',   '"floating"'),
  ('settings.auto_launch',   'false'),
  ('settings.window_geometry', '{"x":null,"y":null,"width":800,"height":600}');
`

// Extend base test with ONLY the userDataDir fixture for per-test tmpdir isolation.
const test = base.extend<{ userDataDir: string }>({
  userDataDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timerz-crash-'))
    await use(dir)
    await fs.rm(dir, { recursive: true, force: true })
  },
})

// ---------------------------------------------------------------------------
// GAP-07: seeded stale heartbeat + NULL end_timestamp → running timer surfaces on boot
// ---------------------------------------------------------------------------
test('crash-recovery: seeded stale heartbeat + running entry → timer shows as running on boot', async ({ userDataDir }) => {
  // --- Seed the DB before launching Electron (D-04 seeding pattern) ---
  const dbPath = path.join(userDataDir, 'timerz.db')
  const db = new DatabaseSync(dbPath)
  // Enable WAL mode + foreign keys (mirrors production database.ts)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // Apply inline schema
  db.exec(SCHEMA_SQL)

  // Seed: timer row
  const nowEpoch = Math.floor(Date.now() / 1000)
  const timerInsert = db.prepare(
    `INSERT INTO timers (project_id, description, notes, created_at, offset) VALUES (?, ?, ?, ?, ?)`
  )
  const timerInfo = timerInsert.run(null, 'Seeded crash-recovery', '', nowEpoch - 700, null)
  const timerId = Number(timerInfo.lastInsertRowid)

  // Seed: running time entry (end_timestamp IS NULL = still running)
  const entryInsert = db.prepare(
    `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`
  )
  const entryInfo = entryInsert.run(timerId, nowEpoch - 700, null)
  const entryId = Number(entryInfo.lastInsertRowid)

  // Seed: stale heartbeat (600s ago >> CRASH_THRESHOLD_SECONDS=300 → crash-suspect)
  const staleBeatAt = nowEpoch - 2 * CRASH_THRESHOLD_SECONDS
  db.prepare(
    `INSERT OR REPLACE INTO heartbeat (id, last_beat, timer_entry_id) VALUES (1, ?, ?)`
  ).run(staleBeatAt, entryId)

  // MUST close before Electron launches — SQLite WAL requires single writer
  db.close()

  // --- Launch Electron against the seeded userDataDir ---
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.mjs')],
    env: {
      ...process.env,
      TIMERZ_USERDATA: userDataDir,
      TIMERZ_NO_SANDBOX: '1',
    },
  })

  try {
    const win = await app.firstWindow()
    // Wait for React to mount
    await win.waitForSelector('[data-testid="timer-table"]', { timeout: 10_000 })

    // Assert: exactly one timer row surfaced (the seeded one)
    await expect(win.getByTestId('timer-row')).toHaveCount(1)

    // Assert: the seeded entry is in running state (Stop button visible)
    // checkResume() at boot detects the stale entry and marks the timer as running.
    await expect(win.getByRole('button', { name: 'Stop timer' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Start timer' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
