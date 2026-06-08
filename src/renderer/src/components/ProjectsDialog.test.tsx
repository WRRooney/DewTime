// @vitest-environment jsdom
// src/renderer/src/components/ProjectsDialog.test.tsx
// Render tests for ProjectsDialog (projects list, empty state, inline edit, Escape revert).
//
// Contract under test:
//   1. Renders one row per project in the mocked projects list
//   2. Renders empty state ("No projects yet") when the list is empty
//   3. Clicking a name cell shows an input; Escape reverts to the original text
//      without calling window.api.projects.updateName
//
// Refs:
//   - 08-03-PLAN.md Task 1 behavior + acceptance_criteria
//   - 08-UI-SPEC.md (Copywriting Contract)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ProjectsDialog } from './ProjectsDialog'
import { useConfirmDeleteProjectStore } from '@/stores/useConfirmDeleteProjectStore'
import type { Project } from '@shared/ipc'
import React from 'react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTMLDialogElement.showModal / close polyfill for jsdom */
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

/** Renders ProjectsDialog as an open modal (showModal polyfilled via ref). */
function renderOpenDialog(projects: Project[] = SAMPLE_PROJECTS) {
  window.api = makeMockApi({
    projects: {
      list: vi.fn().mockResolvedValue(projects),
      updateName: vi.fn().mockResolvedValue(undefined),
      updateNumber: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      countTimerRefs: vi.fn().mockResolvedValue(0),
    },
    system: {
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
    },
  })

  const ref = React.createRef<HTMLDialogElement>()

  const result = renderWithProviders(<ProjectsDialog ref={ref} />)

  // Open the dialog imperatively (mirrors App.tsx showModal usage)
  if (ref.current) {
    ref.current.setAttribute('open', '')
  }

  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectsDialog', () => {
  beforeEach(() => {
    polyfillDialog()
    useConfirmDeleteProjectStore.setState({ pendingDelete: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders one row per project from the mocked projects list', async () => {
    renderOpenDialog(SAMPLE_PROJECTS)

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  it('renders the empty state when the projects list is empty', async () => {
    renderOpenDialog([])

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument()
    })
  })

  it('clicking a name cell shows an input with the current value', async () => {
    const user = userEvent.setup()
    renderOpenDialog(SAMPLE_PROJECTS)

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    await user.click(screen.getByText('Alpha'))

    // An input with the project name should now be present
    const input = screen.getByDisplayValue('Alpha')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('Escape reverts to the original text without calling updateName', async () => {
    const user = userEvent.setup()
    renderOpenDialog(SAMPLE_PROJECTS)

    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())

    // Enter edit mode
    await user.click(screen.getByText('Alpha'))
    const input = screen.getByDisplayValue('Alpha')

    // Type something then press Escape
    await user.clear(input)
    await user.type(input, 'Modified')
    await user.keyboard('{Escape}')

    // Original text restored, no IPC call made
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    expect(window.api.projects.updateName).not.toHaveBeenCalled()
  })
})
