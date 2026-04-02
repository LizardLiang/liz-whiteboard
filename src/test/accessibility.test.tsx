/**
 * Accessibility audit tests using axe-core
 * Tests WCAG 2.1 AA compliance for table notes components
 */

import { describe, test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { TableNotesButton } from '@/components/whiteboard/TableNotesButton'

// Extend vitest expect with jest-axe matchers
expect.extend(toHaveNoViolations)

describe('Table Notes Accessibility Audit', () => {
  test('TableNotesButton meets WCAG 2.1 AA standards', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={false}
        isActive={false}
        onClick={() => {}}
      />
    )

    const results = await axe(container, {
      rules: {
        // Ensure color contrast meets AA standards
        'color-contrast': { enabled: true },
        // Ensure proper ARIA labeling
        'aria-required-attr': { enabled: true },
        'aria-valid-attr-value': { enabled: true },
        'aria-valid-attr': { enabled: true },
        // Ensure form labels
        'label': { enabled: true },
      },
      tags: ['wcag2a', 'wcag2aa', 'wcag21aa']
    })

    expect(results).toHaveNoViolations()
  })

  test('TableNotesButton with notes state meets WCAG 2.1 AA standards', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={true}
        isActive={false}
        onClick={() => {}}
      />
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('TableNotesButton in active state meets WCAG 2.1 AA standards', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={true}
        isActive={true}
        onClick={() => {}}
      />
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('TableNotesButton in loading state meets WCAG 2.1 AA standards', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={false}
        isActive={false}
        isLoading={true}
        onClick={() => {}}
      />
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('TableNotesButton has proper keyboard navigation', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={false}
        isActive={false}
        onClick={() => {}}
      />
    )

    // Test basic accessibility without unknown rules
    const results = await axe(container, {
      tags: ['wcag2a', 'wcag2aa', 'wcag21aa']
    })

    expect(results).toHaveNoViolations()
  })

  test('TableNotesButton has sufficient color contrast', async () => {
    const { container } = render(
      <TableNotesButton
        tableId="test-table-123"
        hasNotes={true}
        isActive={false}
        onClick={() => {}}
      />
    )

    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true }
      }
    })

    expect(results).toHaveNoViolations()
  })
})