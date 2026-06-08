// @vitest-environment jsdom
// Render tests for ProjectsManager (full-window projects manager).
//
// Contract under test:
//   1. Renders one row per project in the mocked projects list
//   2. Renders empty state ("No projects yet") when the list is empty
//   3. Clicking a name cell shows an input with the current value
//   4. Escape reverts to the original text without calling updateName
//
// The manager renders inline (no <dialog> wrapper) since it now lives in its
// own BrowserWindow; tests mount it directly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ProjectsManager } from './ProjectsManager'
import { useConfirmDeleteProjectStore } from '@/stores/useConfirmDeleteProjectStore'
import type { Project } from '@shared/ipc'

// HTMLDialogElement.showModal / close polyfill for jsdom (nested confirm dialog)
function polyfillDialog(): void {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
  }
}

const SAMPLE_PROJECTS: Project[] = [
  { id: 1, project_name: 'Alpha', project_number: 'A-001' },
  { id: 2, project_name: 'Beta', project_number: null },
]

function renderManager(projects: Project[] = SAMPLE_PROJECTS) {
  window.api = makeMockApi({
    projects: {
      list: vi.fn().mockResolvedValue(projects),
      updateName: vi.fn().mockResolvedValue(undefined),
      updateNumber: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      countTimerRefs: vi.fn().mockResolvedValue(0),
    },
  })

  return renderWithProviders(<ProjectsManager />)
}

describe('ProjectsManager', () => {
  beforeEach(() => {
    polyfillDialog()
    useConfirmDeleteProjectStore.setState({ pendingDelete: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders one row per project from the mocked projects list', async () => {
    renderManager(SAMPLE_PROJECTS)

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  it('renders the empty state when the projects list is empty', async () => {
    renderManager([])

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument()
    })
  })

  it('clicking a name cell shows an input with the current value', async () => {
    const user = userEvent.setup()
    renderManager(SAMPLE_PROJECTS)

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    await user.click(screen.getByText('Alpha'))

    const input = screen.getByDisplayValue('Alpha')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('Escape reverts to the original text without calling updateName', async () => {
    const user = userEvent.setup()
    renderManager(SAMPLE_PROJECTS)

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    await user.click(screen.getByText('Alpha'))
    const input = screen.getByDisplayValue('Alpha')

    await user.clear(input)
    await user.type(input, 'Modified')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    expect(window.api.projects.updateName).not.toHaveBeenCalled()
  })

  // WR-02 — on a rename mutation error the field must STAY in edit mode showing
  // the user's draft, not revert to the read-only old name.
  it('keeps the name field in edit mode with the draft visible when updateName rejects', async () => {
    const user = userEvent.setup()
    window.api = makeMockApi({
      projects: {
        list: vi.fn().mockResolvedValue(SAMPLE_PROJECTS),
        updateName: vi.fn().mockRejectedValue(new Error('duplicate')),
        updateNumber: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        countTimerRefs: vi.fn().mockResolvedValue(0),
      },
    })
    renderWithProviders(<ProjectsManager />)

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    await user.click(screen.getByText('Alpha'))
    const input = screen.getByDisplayValue('Alpha')
    await user.clear(input)
    await user.type(input, 'Beta')
    await user.keyboard('{Enter}')

    // Error surfaces AND the input (with the draft) is still present.
    await waitFor(() => {
      expect(screen.getByText('Could not save. Try again.')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument()
  })
})
