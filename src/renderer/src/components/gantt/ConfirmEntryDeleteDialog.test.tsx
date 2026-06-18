// @vitest-environment jsdom
// src/renderer/src/components/gantt/ConfirmEntryDeleteDialog.test.tsx
//
// Contract under test:
//   1. Store null → dialog NOT open
//   2. Store open(id, label) → dialog opens with "Delete entry?" copy (D-24)
//   3. Delete button → calls window.api.timeEntries.deleteEntry(id) + closes dialog
//   4. Cancel button → closes dialog without any IPC call
//
// Refs:
//   - 09-05-PLAN.md Task 2 acceptance_criteria
//   - 09-UI-SPEC.md §Copywriting Contract (Delete entry? copy)
//   - ConfirmDialog.test.tsx (analog pattern)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ConfirmEntryDeleteDialog } from './ConfirmEntryDeleteDialog'
import { useConfirmDeleteEntryStore } from '@/stores/useConfirmDeleteEntryStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTMLDialogElement.showModal / close polyfill for jsdom */
function polyfillDialog() {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfirmEntryDeleteDialog', () => {
  beforeEach(() => {
    polyfillDialog()
    // Reset store state between tests
    useConfirmDeleteEntryStore.setState({ pendingDelete: null })
    // Install fresh mock API
    window.api = makeMockApi({
      timeEntries: {
        deleteEntry: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('dialog is not open when pendingDelete is null', () => {
    renderWithProviders(<ConfirmEntryDeleteDialog />)
    const dialog = document.querySelector('dialog')
    expect(dialog).not.toBeNull()
    expect(dialog!.open).toBe(false)
  })

  it('opens dialog with "Delete entry?" copy when pendingDelete is set (D-24)', async () => {
    renderWithProviders(<ConfirmEntryDeleteDialog />)

    useConfirmDeleteEntryStore.getState().open(42, 'My Timer')

    await waitFor(() => {
      expect(document.querySelector('dialog')!.open).toBe(true)
    })

    // D-24 Copywriting Contract exact copy
    expect(screen.getByText('Delete entry?')).toBeInTheDocument()
    expect(
      screen.getByText('This will permanently remove the time entry. This cannot be undone.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Delete button calls timeEntries.deleteEntry(id) and closes dialog', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConfirmEntryDeleteDialog />)

    useConfirmDeleteEntryStore.getState().open(42, 'My Timer')
    await waitFor(() => expect(document.querySelector('dialog')!.open).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(window.api.timeEntries.deleteEntry).toHaveBeenCalledWith(42)
      expect(useConfirmDeleteEntryStore.getState().pendingDelete).toBeNull()
    })
  })

  it('Cancel button closes dialog without any IPC call', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConfirmEntryDeleteDialog />)

    useConfirmDeleteEntryStore.getState().open(42, 'My Timer')
    await waitFor(() => expect(document.querySelector('dialog')!.open).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useConfirmDeleteEntryStore.getState().pendingDelete).toBeNull()
    expect(window.api.timeEntries.deleteEntry).not.toHaveBeenCalled()
  })
})
