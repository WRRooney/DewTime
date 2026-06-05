// @vitest-environment jsdom
// src/renderer/src/components/ConfirmDialog.test.tsx
// Tests for ConfirmDialog reactive open/close + Cancel + Delete behavior (D-24, D-32).
//
// Contract under test:
//   1. pendingDelete null → dialog is NOT open
//   2. pendingDelete set → dialog opens + body shows label with straight ASCII double quotes
//   3. Cancel click → close() called; NO timers.delete IPC call
//   4. Delete click → timers.delete(id) called + pendingDelete cleared
//
// Refs:
//   - 04-CONTEXT.md D-24 (ConfirmDialog pattern — store-driven open/close)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage)
//   - 04-RESEARCH.md § Pattern 9 (ConfirmDialog template)
//   - 04-UI-SPEC.md § ConfirmDialog (copy + footer button order)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { ConfirmDialog } from './ConfirmDialog'
import { useConfirmDeleteStore } from '@/stores/useConfirmDeleteStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTMLDialogElement.showModal / close polyfill for jsdom */
function polyfillDialog() {
  // jsdom 29 supports showModal; guard in case a test env doesn't
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

describe('ConfirmDialog', () => {
  beforeEach(() => {
    polyfillDialog()
    // Reset store state between tests so dialogs don't bleed across cases
    useConfirmDeleteStore.setState({ pendingDelete: null })
    // Install a fresh mock API with a delete stub
    window.api = makeMockApi({
      timers: { delete: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('dialog is not open when pendingDelete is null', () => {
    renderWithProviders(<ConfirmDialog />)
    const dialog = document.querySelector('dialog')
    expect(dialog).not.toBeNull()
    // dialog.open is false when no pendingDelete
    expect(dialog!.open).toBe(false)
  })

  it('opens dialog and renders label with straight ASCII double quotes when pendingDelete is set', async () => {
    renderWithProviders(<ConfirmDialog />)

    // Trigger the open
    useConfirmDeleteStore.getState().open(7, 'foo')

    await waitFor(() => {
      const dialog = document.querySelector('dialog')
      expect(dialog!.open).toBe(true)
    })

    // Body must contain the label wrapped in straight ASCII double quotes
    expect(screen.getByText(/Delete timer "foo"\?/)).toBeInTheDocument()
    expect(screen.getByText(/This also removes its time entries\./)).toBeInTheDocument()
  })

  it('Cancel click calls close() without calling timers.delete', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConfirmDialog />)

    useConfirmDeleteStore.getState().open(7, 'foo')
    await waitFor(() => expect(document.querySelector('dialog')!.open).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useConfirmDeleteStore.getState().pendingDelete).toBeNull()
    expect(window.api.timers.delete).not.toHaveBeenCalled()
  })

  it('Delete click calls timers.delete(id) and closes dialog', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConfirmDialog />)

    useConfirmDeleteStore.getState().open(7, 'bar')
    await waitFor(() => expect(document.querySelector('dialog')!.open).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(window.api.timers.delete).toHaveBeenCalledWith(7)
      expect(useConfirmDeleteStore.getState().pendingDelete).toBeNull()
    })
  })
})
