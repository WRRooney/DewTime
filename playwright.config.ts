// playwright.config.ts
// Playwright E2E config for DewTime.
//
// D-02: testMatch '**/*.e2e.ts' keeps E2E specs out of Vitest globs which
// match '*.test.ts'. The `npm run test:e2e` script calls this config
// separately via `playwright test --config playwright.config.ts`.
//
// No 'projects' browser entry — _electron.launch is used per-test in fixtures.ts
// (Playwright Electron support does not use a browser 'projects' entry).
//
// Refs:
//   - 07-03-PLAN.md Task 3 (D-01, D-02)
//   - 07-PATTERNS.md playwright.config.ts exact shape
//   - 07-RESEARCH.md Pattern 1 (Playwright Electron Fixture)
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',        // explicit; keeps out of npm test globs
  timeout: 30_000,
  // Cold Electron start + first IPC round-trip can exceed the 5s default on CI
  // runners; 10s absorbs the first-paint latency without masking real hangs.
  expect: { timeout: 10_000 },
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    // No browser launch here — _electron.launch is used per-test in fixtures.ts.
    // Playwright Electron support does not use a 'projects' browser entry.
  },
})
