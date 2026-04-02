/**
 * Test file for TableNotesButton component
 * Tests visual states, click handlers, and accessibility
 */

import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TableNotesButton } from './TableNotesButton'

describe('TableNotesButton', () => {
  const defaultProps = {
    tableId: 'test-table-123',
    hasNotes: false,
    isActive: false,
    onClick: vi.fn(),
  }

  test('renders correctly', () => {
    render(<TableNotesButton {...defaultProps} />)

    const button = screen.getByRole('button')
    expect(button).toBeDefined()
  })

  test('handles click interactions correctly', () => {
    const mockOnClick = vi.fn()
    render(<TableNotesButton {...defaultProps} onClick={mockOnClick} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  test('is disabled when loading', () => {
    render(<TableNotesButton {...defaultProps} isLoading={true} />)

    const button = screen.getByRole('button')
    expect(button.disabled).toBe(true)
  })

  test('has proper accessibility attributes', () => {
    render(<TableNotesButton {...defaultProps} />)

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toBe('Add notes for table test-table-123')
  })

  test('includes nodrag and nowheel classes for ReactFlow compatibility', () => {
    render(<TableNotesButton {...defaultProps} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('nodrag')
    expect(button.className).toContain('nowheel')
  })
})