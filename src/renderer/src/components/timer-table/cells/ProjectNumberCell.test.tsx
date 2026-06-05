// @vitest-environment jsdom
// src/renderer/src/components/timer-table/cells/ProjectNumberCell.test.tsx
// Tests for ProjectNumberCell inline editor — PROJ-04 requirement.
//
// Contract under test:
//   1. Renders "—" with no edit affordance when project_id is null.
//   2. With a project assigned, clicking enters edit mode;
//      Enter commits via window.api.projects.updateNumber (PROJ-04).
//   3. Escape reverts without calling updateNumber.
//
// Mock strategy: set window.api = makeMockApi({ projects: { list: vi.fn(), updateNumber: vi.fn() } })
// in beforeEach so mutation hooks resolve immediately.
//
// Refs:
//   - 05-UI-SPEC.md § ProjectNumberCell (interaction/copy spec)
//   - 05-CONTEXT.md D-04 (inline editable project # column)
//   - src/renderer/src/components/timer-table/cells/DescriptionCell.test.tsx (pattern)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ProjectNumberCell } from './ProjectNumberCell'
import type { Timer, Project } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 1,
    project_id: null,
    description: 'My timer',
    notes: '',
    created_at: 1700000000 as EpochSeconds,
    offset: null,
    totalSeconds: 0,
    running: false,
    ...overrides,
  }
}

const PROJECT_WITH_NUMBER: Project = { id: 10, project_name: 'Acme Corp', project_number: '1042' }
const PROJECT_WITHOUT_NUMBER: Project = { id: 11, project_name: 'Beta LLC', project_number: null }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectNumberCell', () => {
  let updateNumberMock: ReturnType<typeof vi.fn>
  let listProjectsMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    updateNumberMock = vi.fn().mockResolvedValue(undefined)
    listProjectsMock = vi.fn().mockResolvedValue([PROJECT_WITH_NUMBER, PROJECT_WITHOUT_NUMBER])
    window.api = makeMockApi({
      projects: {
        list: listProjectsMock,
        updateNumber: updateNumberMock,
      },
      timers: {
        list: vi.fn().mockResolvedValue([]),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders "—" (em dash) with no edit affordance when project_id is null', () => {
    const timer = makeTimer({ project_id: null })
    renderWithProviders(<ProjectNumberCell timer={timer} />)

    // The em dash should be present in the non-editable emptyNoProject span
    const dash = document.querySelector('[class*="emptyNoProject"]')
    expect(dash).not.toBeNull()

    // Clicking on it should NOT open an input
    const el = document.querySelector('[class*="emptyNoProject"]') as HTMLElement
    el.click()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('with a project assigned, clicking enters edit mode with the number', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ project_id: PROJECT_WITH_NUMBER.id })
    renderWithProviders(<ProjectNumberCell timer={timer} />)

    // Wait for projects to load, then number to appear
    const numberSpan = await screen.findByText('1042')
    expect(numberSpan).toBeInTheDocument()

    // No input initially
    expect(screen.queryByRole('textbox')).toBeNull()

    // Click enters edit mode
    await user.click(numberSpan)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Enter commits via projects.updateNumber with the new value (PROJ-04)', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 5, project_id: PROJECT_WITH_NUMBER.id })
    renderWithProviders(<ProjectNumberCell timer={timer} />)

    // Wait for projects to load
    await screen.findByText('1042')

    // Enter edit mode
    await user.click(screen.getByText('1042'))
    const input = screen.getByRole('textbox')

    // Clear and type new value
    await user.clear(input)
    await user.type(input, '9999')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(updateNumberMock).toHaveBeenCalledWith(PROJECT_WITH_NUMBER.id, '9999')
    })

    // Input closes
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Escape reverts without calling updateNumber', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 5, project_id: PROJECT_WITH_NUMBER.id })
    renderWithProviders(<ProjectNumberCell timer={timer} />)

    // Wait for projects to load
    await screen.findByText('1042')

    // Enter edit mode
    await user.click(screen.getByText('1042'))
    const input = screen.getByRole('textbox')

    // Type new value
    await user.clear(input)
    await user.type(input, 'changed')

    // Cancel via Escape
    await user.keyboard('{Escape}')

    // updateNumber should NOT have been called
    expect(updateNumberMock).not.toHaveBeenCalled()

    // Input closes
    expect(screen.queryByRole('textbox')).toBeNull()

    // Original value is still shown
    expect(screen.getByText('1042')).toBeInTheDocument()
  })

  it('renders editable "—" (in .text class) when project is assigned but has no number', async () => {
    const timer = makeTimer({ project_id: PROJECT_WITHOUT_NUMBER.id })
    renderWithProviders(<ProjectNumberCell timer={timer} />)

    // Wait for projects list to load — the cell switches from emptyNoProject
    // to .text state once the cache resolves the project (project_id is set).
    // The .text span should be present (not emptyNoProject) once loaded.
    await waitFor(() => {
      const emptyNoProject = document.querySelector('[class*="emptyNoProject"]')
      expect(emptyNoProject).toBeNull()
    })

    // The .text span should be present (cursor:text — editable)
    const textSpan = document.querySelector('[class*="_text"]')
    expect(textSpan).not.toBeNull()
  })
})
