// @vitest-environment jsdom
// src/renderer/src/components/timer-table/cells/ProjectCell.test.tsx
// Tests for ProjectCell cmdk combobox — PROJ-01/02/03 requirements.
//
// Contract under test:
//   1. Renders the assigned project's name when timer.project_id matches a project
//      in the useProjects cache (D-14 client-side join).
//   2. Renders "(no project)" placeholder when project_id is null.
//   3. Clicking the cell opens the combobox; typing a substring filters items
//      case-insensitively (PROJ-02).
//   4. Selecting an item calls window.api.timers.setProject with (timer.id, project.id) (PROJ-01).
//   5. Typing an unmatched name and triggering the Create affordance calls
//      window.api.projects.create then window.api.timers.setProject (PROJ-03 create-then-select).
//
// Mock strategy: set window.api = makeMockApi({ projects: { list: vi.fn() }, timers: { setProject: vi.fn() } })
// in beforeEach so mutation hooks resolve immediately.
//
// Refs:
//   - 05-UI-SPEC.md § ProjectCell (interaction/copy spec)
//   - 05-CONTEXT.md D-12/D-13/D-14
//   - src/renderer/src/components/timer-table/cells/DescriptionCell.test.tsx (pattern)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ProjectCell } from './ProjectCell'
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

const PROJECT_ACME: Project = { id: 10, project_name: 'Acme Corp', project_number: '1001' }
const PROJECT_BETA: Project = { id: 11, project_name: 'Beta LLC', project_number: null }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectCell', () => {
  let setProjectMock: ReturnType<typeof vi.fn>
  let createProjectMock: ReturnType<typeof vi.fn>
  let listProjectsMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setProjectMock = vi.fn().mockResolvedValue(undefined)
    createProjectMock = vi.fn().mockResolvedValue({ id: 99, project_name: 'New Project', project_number: null })
    listProjectsMock = vi.fn().mockResolvedValue([PROJECT_ACME, PROJECT_BETA])
    window.api = makeMockApi({
      projects: {
        list: listProjectsMock,
        create: createProjectMock,
      },
      timers: {
        list: vi.fn().mockResolvedValue([]),
        setProject: setProjectMock,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the assigned project name when project_id matches a project in cache (D-14)', async () => {
    const timer = makeTimer({ project_id: PROJECT_ACME.id })
    renderWithProviders(<ProjectCell timer={timer} />)

    // Project name should appear from the useProjects cache.
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('renders "(no project)" placeholder when project_id is null', () => {
    const timer = makeTimer({ project_id: null })
    renderWithProviders(<ProjectCell timer={timer} />)

    expect(screen.getByText('(no project)')).toBeInTheDocument()
  })

  it('clicking the cell opens the combobox', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ project_id: null })
    renderWithProviders(<ProjectCell timer={timer} />)

    // Initially no input
    expect(screen.queryByPlaceholderText('Search projects…')).toBeNull()

    // Click triggers open
    await user.click(screen.getByText('(no project)'))

    expect(screen.getByPlaceholderText('Search projects…')).toBeInTheDocument()
  })

  it('typing a substring filters items case-insensitively (PROJ-02)', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ project_id: null })
    renderWithProviders(<ProjectCell timer={timer} />)

    // Open the dropdown
    await user.click(screen.getByText('(no project)'))

    // Wait for projects to load
    expect(await screen.findByPlaceholderText('Search projects…')).toBeInTheDocument()

    // Wait for projects to appear in the list
    await screen.findByText('Acme Corp')

    // Type a case-insensitive substring match for "Acme Corp"
    const input = screen.getByPlaceholderText('Search projects…')
    await user.type(input, 'ac')

    // Acme Corp should still be visible, Beta LLC should not
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
    // Beta LLC should not be visible (no substring match for "ac")
    await waitFor(() => {
      expect(screen.queryByText('Beta LLC')).toBeNull()
    })
  })

  it('selecting an item calls timers.setProject with (timer.id, project.id) (PROJ-01)', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 42, project_id: null })
    renderWithProviders(<ProjectCell timer={timer} />)

    // Open the dropdown
    await user.click(screen.getByText('(no project)'))

    // Wait for projects to load
    await screen.findByText('Acme Corp')

    // Click on a project
    await user.click(screen.getByText('Acme Corp'))

    await waitFor(() => {
      expect(setProjectMock).toHaveBeenCalledWith(42, PROJECT_ACME.id)
    })
  })

  it('typing an unmatched name + Create calls projects.create then timers.setProject (PROJ-03)', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, project_id: null })
    renderWithProviders(<ProjectCell timer={timer} />)

    // Open the dropdown
    await user.click(screen.getByText('(no project)'))

    // Wait for projects to load
    await screen.findByText('Acme Corp')

    const input = screen.getByPlaceholderText('Search projects…')
    await user.type(input, 'New Project')

    // Create button should appear in Command.Empty
    const createBtn = await screen.findByText('Create "New Project"')
    expect(createBtn).toBeInTheDocument()

    await user.click(createBtn)

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith('New Project', null)
    })
    await waitFor(() => {
      expect(setProjectMock).toHaveBeenCalledWith(7, 99)
    })
  })
})
