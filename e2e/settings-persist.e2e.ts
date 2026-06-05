// e2e/settings-persist.e2e.ts
// GAP-05: settings week-start persists across a real quit + relaunch against the same
//         userData dir (D-05: real restart, NOT in-memory state).
// GAP-06: settings dialog OK persists; Cancel does NOT persist a change.
//
// These tests do NOT use the shared `electronApp`/`window` fixtures — they need to
// launch Electron manually (twice for the restart test) while reusing the `userDataDir`
// fixture for per-test tmpdir isolation and teardown.
//
// Selectors (established in plan 07-03 / PATTERNS.md):
//   - Gear button:   getByRole('button', { name: 'Open settings' })
//   - Sunday radio:  getByRole('radio', { name: 'Sunday' })
//   - Monday radio:  getByRole('radio', { name: 'Monday' })
//   - OK button:     getByRole('button', { name: 'OK' })
//   - Cancel button: getByRole('button', { name: 'Cancel' })
//
// D-05 restart pattern: launch1 → change setting → OK → close; launch2 same userDataDir
//   → open settings → assert Sunday checked (proves SQLite settings table persistence).
//
// Refs:
//   - 07-04-PLAN.md Task 2 (GAP-05, GAP-06)
//   - 07-PATTERNS.md § e2e/settings-persist.e2e.ts (D-05 restart skeleton)
//   - src/renderer/src/components/SettingsDialog.tsx (dialog selectors)
//   - src/renderer/src/components/TitleBar.tsx (gear button aria-label)

import { test as base, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// Extend base test with ONLY the userDataDir fixture for per-test tmpdir isolation.
// The electronApp/window fixtures are NOT used here — we launch manually.
const test = base.extend<{ userDataDir: string }>({
  userDataDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timerz-settings-'))
    await use(dir)
    await fs.rm(dir, { recursive: true, force: true })
  },
})

/** Helper: launch Electron against a userDataDir and wait for the timer-table to mount. */
async function launchApp(userDataDir: string) {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.mjs')],
    env: {
      ...process.env,
      TIMERZ_USERDATA: userDataDir,
      TIMERZ_NO_SANDBOX: '1',
    },
  })
  const win = await app.firstWindow()
  await win.waitForSelector('[data-testid="timer-table"]', { timeout: 10_000 })
  return { app, win }
}

// ---------------------------------------------------------------------------
// GAP-05: week-start persists across real quit + relaunch (D-05)
// ---------------------------------------------------------------------------
test('settings week-start persists across quit + relaunch (D-05)', async ({ userDataDir }) => {
  // --- Launch 1: change week-start to Sunday, click OK, quit ---
  const { app: app1, win: win1 } = await launchApp(userDataDir)
  try {
    // Open settings dialog
    await win1.getByRole('button', { name: 'Open settings' }).click()

    // Select Sunday (default is Monday)
    await win1.getByRole('radio', { name: 'Sunday' }).click()
    await expect(win1.getByRole('radio', { name: 'Sunday' })).toBeChecked()

    // Click OK to persist + close
    await win1.getByRole('button', { name: 'OK' }).click()
    // Dialog should be closed now
    await expect(win1.getByRole('radio', { name: 'Sunday' })).not.toBeVisible()
  } finally {
    await app1.close()
  }

  // --- Launch 2 against the SAME userDataDir: assert Sunday is still checked ---
  const { app: app2, win: win2 } = await launchApp(userDataDir)
  try {
    // Open settings dialog again
    await win2.getByRole('button', { name: 'Open settings' }).click()

    // Assert: Sunday persisted through SQLite settings table across a real restart
    await expect(win2.getByRole('radio', { name: 'Sunday' })).toBeChecked()
    await expect(win2.getByRole('radio', { name: 'Monday' })).not.toBeChecked()
  } finally {
    await app2.close()
  }
})

// ---------------------------------------------------------------------------
// GAP-06: Cancel does NOT persist a change
// ---------------------------------------------------------------------------
test('settings Cancel does not persist the draft change', async ({ userDataDir }) => {
  const { app, win } = await launchApp(userDataDir)
  try {
    // Open settings — default is Monday
    await win.getByRole('button', { name: 'Open settings' }).click()
    await expect(win.getByRole('radio', { name: 'Monday' })).toBeChecked()

    // Change to Sunday
    await win.getByRole('radio', { name: 'Sunday' }).click()
    await expect(win.getByRole('radio', { name: 'Sunday' })).toBeChecked()

    // Click Cancel — change must NOT persist
    await win.getByRole('button', { name: 'Cancel' }).click()
    // Dialog closes
    await expect(win.getByRole('radio', { name: 'Sunday' })).not.toBeVisible()

    // Re-open settings — Monday must still be selected (Cancel discarded the draft)
    await win.getByRole('button', { name: 'Open settings' }).click()
    await expect(win.getByRole('radio', { name: 'Monday' })).toBeChecked()
    await expect(win.getByRole('radio', { name: 'Sunday' })).not.toBeChecked()

    // Close dialog
    await win.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await app.close()
  }
})
