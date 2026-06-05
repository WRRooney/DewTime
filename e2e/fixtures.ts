// e2e/fixtures.ts
// Shared Playwright Electron fixture with per-test DB isolation.
//
// Provides three fixtures via test.extend():
//   1. userDataDir  — per-test tmpdir; teardown does fs.rm(recursive, force)
//   2. electronApp  — launches out/main/index.mjs via _electron.launch with
//                     TIMERZ_USERDATA + TIMERZ_NO_SANDBOX env; closes on teardown
//   3. window       — electronApp.firstWindow() + waitForSelector timer-table
//
// TIMERZ_USERDATA: passes per-test tmpdir so database.ts initDb() uses it
//   instead of app.getPath('userData') (D-03 seam in src/main/db/database.ts).
//
// TIMERZ_NO_SANDBOX: '1' — required on Linux CI (Electron 36+ sandbox tightening
//   in GitHub Actions; src/main/index.ts lines 80-82 seam appends --no-sandbox).
//   See 07-RESEARCH.md Pitfall 1.
//
// Note: e2e/ files cannot use the @main/@shared path aliases (those are for
//   src/ tsconfigs only). Use relative paths for any imports from src/.
//
// Refs:
//   - 07-03-PLAN.md Task 3
//   - 07-PATTERNS.md e2e/fixtures.ts full fixture body
//   - 07-RESEARCH.md Pattern 1 (Playwright Electron Fixture)
//   - 07-RESEARCH.md Pitfall 1 (TIMERZ_NO_SANDBOX Linux CI fix)

import { test as base, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

interface E2EFixtures {
  userDataDir: string
  electronApp: ElectronApplication
  window: Page
}

export const test = base.extend<E2EFixtures>({
  // Fixture 1: per-test isolated tmpdir for SQLite DB
  // Teardown: fs.rm(recursive, force) — runs even on test failure (Playwright guarantee)
  userDataDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timerz-e2e-'))
    await use(dir)
    await fs.rm(dir, { recursive: true, force: true })
  },

  // Fixture 2: Electron app launched against out/ build with per-test DB isolation
  electronApp: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [path.join(process.cwd(), 'out/main/index.mjs')],
      env: {
        ...process.env,
        TIMERZ_USERDATA: userDataDir,
        // Pitfall 1 fix: src/main/index.ts lines 80-82 seam appends --no-sandbox
        // when this is set; required on Linux CI for Electron 36+ launch.
        TIMERZ_NO_SANDBOX: '1',
      },
    })
    await use(app)
    await app.close()
  },

  // Fixture 3: first BrowserWindow, waited until React mounts timer-table
  window: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow()
    // Wait for React to mount — timer-table data-testid added in Task 2 (07-03)
    await win.waitForSelector('[data-testid="timer-table"]', { timeout: 10_000 })
    await use(win)
  },
})

export { expect }
