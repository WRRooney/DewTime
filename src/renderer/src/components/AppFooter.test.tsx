// @vitest-environment jsdom
// src/renderer/src/components/AppFooter.test.tsx
// Tests for AppFooter after Projects button removal (D-30/D-31).
//
// Contract under test:
//   1. Renders the version button (opens releases) — D-31
//   2. Clicking the version button fires window.api.system.openReleases — D-31
//   3. Does NOT render a Projects button — D-30
//   4. Accepts no onOpenProjects prop — D-30
//
// Refs:
//   - 09-04-PLAN.md Task 2
//   - 09-CONTEXT.md D-30, D-31

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { AppFooter } from './AppFooter'

beforeEach(() => {
  window.api = makeMockApi({
    system: {
      openReleases: vi.fn().mockResolvedValue(undefined),
      getVersion: vi.fn().mockResolvedValue('1.2.3'),
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('AppFooter', () => {
  it('renders the version button (D-31)', () => {
    renderWithProviders(<AppFooter />)
    const versionBtn = screen.getByRole('button', { name: /view releases on github/i })
    expect(versionBtn).toBeInTheDocument()
  })

  it('clicking the version button calls window.api.system.openReleases (D-31)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppFooter />)

    const versionBtn = screen.getByRole('button', { name: /view releases on github/i })
    await user.click(versionBtn)

    expect(window.api.system.openReleases).toHaveBeenCalledTimes(1)
  })

  it('does NOT render a Projects button (D-30)', () => {
    renderWithProviders(<AppFooter />)
    // There must be no button with the text "Projects" or aria-label "Projects"
    const projectsBtn = screen.queryByRole('button', { name: /projects/i })
    expect(projectsBtn).toBeNull()
  })

  it('component function signature accepts no props — no onOpenProjects (D-30)', () => {
    // If AppFooter still required onOpenProjects, TypeScript would have caught it.
    // This test confirms the component renders without any props at all.
    expect(() => renderWithProviders(<AppFooter />)).not.toThrow()
  })
})
