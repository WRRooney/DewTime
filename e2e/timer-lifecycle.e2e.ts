// e2e/timer-lifecycle.e2e.ts
// GAP-01: timer start/stop via real UI — start shows Stop button; stop shows Start button.
// GAP-02: single-active-timer invariant — starting a second timer stops the first;
//         exactly one Stop button exists at any time.
//
// Fixture: uses shared `window` fixture from fixtures.ts (per-test isolated tmpdir DB).
// The DB starts empty, so each test first clicks "Add Timer" to seed rows.
//
// Selectors (established in plan 07-03):
//   - Start button: getByRole('button', { name: 'Start timer' })
//   - Stop button:  getByRole('button', { name: 'Stop timer' })
//   - Add Timer:    getByRole('button', { name: /add timer/i })
//   - Timer row:    getByTestId('timer-row')
//
// Refs:
//   - 07-04-PLAN.md Task 1 (GAP-01, GAP-02)
//   - 07-RESEARCH.md § Code Examples Timer Start/Stop skeleton
//   - 07-PATTERNS.md § e2e/timer-lifecycle.e2e.ts (selector sources)
//   - e2e/fixtures.ts (shared fixture)

import { test, expect } from './fixtures'

// ---------------------------------------------------------------------------
// GAP-01: start timer → Stop button becomes visible; stop timer → Start button back
// ---------------------------------------------------------------------------
test('start timer — shows Stop button; stop timer — shows Start button', async ({ window }) => {
  // The DB starts empty. Add one timer row so we have something to start.
  await window.getByRole('button', { name: /add timer/i }).click()
  // Wait for the new row to appear (start button should be visible)
  await expect(window.getByRole('button', { name: 'Start timer' }).first()).toBeVisible()

  // Act: start the timer
  await window.getByRole('button', { name: 'Start timer' }).first().click()

  // Assert: Stop button is now visible (running state)
  await expect(window.getByRole('button', { name: 'Stop timer' }).first()).toBeVisible()
  // Start button should no longer be visible for this timer
  await expect(window.getByRole('button', { name: 'Start timer' })).toHaveCount(0)

  // Act: stop the timer
  await window.getByRole('button', { name: 'Stop timer' }).first().click()

  // Assert: Start button is back (stopped state)
  await expect(window.getByRole('button', { name: 'Start timer' }).first()).toBeVisible()
  await expect(window.getByRole('button', { name: 'Stop timer' })).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// GAP-02: single-active-timer invariant — starting second timer stops the first
// ---------------------------------------------------------------------------
test('single-active-timer invariant — starting second stops first, exactly one Stop button', async ({ window }) => {
  // Add two timer rows
  await window.getByRole('button', { name: /add timer/i }).click()
  await expect(window.getByTestId('timer-row')).toHaveCount(1)

  await window.getByRole('button', { name: /add timer/i }).click()
  await expect(window.getByTestId('timer-row')).toHaveCount(2)

  // Both rows start in stopped state (two Start buttons, zero Stop buttons)
  await expect(window.getByRole('button', { name: 'Start timer' })).toHaveCount(2)
  await expect(window.getByRole('button', { name: 'Stop timer' })).toHaveCount(0)

  // Start the first timer
  await window.getByTestId('timer-row').nth(0).getByRole('button', { name: 'Start timer' }).click()
  // Exactly one Stop button (first timer running)
  await expect(window.getByRole('button', { name: 'Stop timer' })).toHaveCount(1)
  await expect(window.getByRole('button', { name: 'Start timer' })).toHaveCount(1)

  // Start the second timer — should stop the first (single-active invariant TIME-03)
  await window.getByTestId('timer-row').nth(1).getByRole('button', { name: 'Start timer' }).click()

  // Assert: still exactly one Stop button (second timer now running, first stopped)
  await expect(window.getByRole('button', { name: 'Stop timer' })).toHaveCount(1)
  await expect(window.getByRole('button', { name: 'Start timer' })).toHaveCount(1)
})
