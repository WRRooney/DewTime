// e2e/field-editing.e2e.ts
// GAP-03: description in-place edit via real UI — click cell, type, Enter commits.
// GAP-04: project type-ahead via real Electron renderer — click trigger, type substring,
//         dropdown filters to match, click option, project name shown in cell.
//
// Fixture: uses shared `window` fixture from fixtures.ts (per-test isolated tmpdir DB).
// The DB starts empty, so each test first clicks "Add Timer" to seed a row.
//
// For GAP-04 the test creates a project via the "Create …" cmdk item (type name not
// matching any existing project → Create item appears → click creates + selects it).
// Then a second test opens the dropdown for a row, types a substring of the project
// that was created in a fresh session, and confirms filtering + selection.
//
// Selectors (established in plan 07-03):
//   - Description cell (rest):  getByTestId('description-cell')
//   - Description input (edit): getByTestId('description-input')
//   - Project trigger:          getByTestId('project-trigger')
//   - cmdk input:               getByPlaceholder('Search projects…')
//   - cmdk option:              getByRole('option', { name: … })
//   - Add Timer:                getByRole('button', { name: /add timer/i })
//
// Refs:
//   - 07-04-PLAN.md Task 1 (GAP-03, GAP-04)
//   - 07-PATTERNS.md § e2e/field-editing.e2e.ts (selector sources)
//   - src/renderer/src/components/timer-table/cells/DescriptionCell.tsx
//   - src/renderer/src/components/timer-table/cells/ProjectCell.tsx

import { test, expect } from './fixtures'

// ---------------------------------------------------------------------------
// GAP-03: description in-place edit — click, type, Enter commits
// ---------------------------------------------------------------------------
test('description in-place edit — click, type, Enter commits', async ({ window }) => {
  // Add a timer row (DB starts empty)
  await window.getByRole('button', { name: /add timer/i }).click()
  await expect(window.getByTestId('description-cell')).toBeVisible()

  // Click the description cell to enter edit mode
  await window.getByTestId('description-cell').click()

  // The input should appear
  const input = window.getByTestId('description-input')
  await expect(input).toBeVisible()

  // Type a description and commit with Enter
  await input.fill('E2E Test Description')
  await input.press('Enter')

  // The cell returns to rest state with the new text visible
  await expect(window.getByTestId('description-cell')).toBeVisible()
  await expect(window.getByTestId('description-cell')).toHaveText('E2E Test Description')

  // Edit again and press Escape — should cancel (original value restored)
  await window.getByTestId('description-cell').click()
  const input2 = window.getByTestId('description-input')
  await input2.fill('Should Not Commit')
  await input2.press('Escape')

  // Original description should still be shown
  await expect(window.getByTestId('description-cell')).toHaveText('E2E Test Description')
})

// ---------------------------------------------------------------------------
// GAP-04: project type-ahead — create via cmdk, then type substring to filter + select
// ---------------------------------------------------------------------------
test('project type-ahead — create project via cmdk, then filter by substring and select', async ({ window }) => {
  // Add a timer row
  await window.getByRole('button', { name: /add timer/i }).click()
  await expect(window.getByTestId('project-trigger')).toBeVisible()

  // Open the project dropdown
  await window.getByTestId('project-trigger').click()
  const cmdkInput = window.getByPlaceholder('Search projects…')
  await expect(cmdkInput).toBeVisible()

  // Type a project name that doesn't exist yet → Create "…" item appears
  await cmdkInput.fill('AlphaProject')

  // The Create "AlphaProject" item should appear in the list
  // cmdk renders Command.Item elements — check for text containing the project name
  const createItem = window.getByText('Create "AlphaProject"')
  await expect(createItem).toBeVisible()

  // Click to create + select the project
  await createItem.click()

  // The project trigger now shows the project name
  await expect(window.getByTestId('project-trigger')).toContainText('AlphaProject')
})

test('project type-ahead — type substring to filter existing project and select', async ({ window }) => {
  // Add a timer row and create a project on it first
  await window.getByRole('button', { name: /add timer/i }).click()
  await expect(window.getByTestId('project-trigger')).toBeVisible()

  // Open the project dropdown and create a project
  await window.getByTestId('project-trigger').click()
  await window.getByPlaceholder('Search projects…').fill('BetaProject')
  await window.getByText('Create "BetaProject"').click()
  await expect(window.getByTestId('project-trigger')).toContainText('BetaProject')

  // Now open the dropdown again and type a substring ("Beta") to filter
  await window.getByTestId('project-trigger').click()
  const cmdkInput = window.getByPlaceholder('Search projects…')
  await cmdkInput.fill('Beta')

  // The existing project should appear as an option
  // cmdk renders items that pass the substring filter
  const existingOption = window.getByRole('option', { name: 'BetaProject' })
  await expect(existingOption).toBeVisible()

  // Click the option to select it
  await existingOption.click()

  // The trigger shows the project name
  await expect(window.getByTestId('project-trigger')).toContainText('BetaProject')
})
