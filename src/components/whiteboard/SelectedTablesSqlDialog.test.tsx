// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SelectedTablesSqlDialog } from './SelectedTablesSqlDialog'
import { buildJoinQueryPlan } from '@/lib/join-query-generator'

vi.mock('@/lib/copy-text', () => ({ copyText: vi.fn(async () => true) }))

const plan = buildJoinQueryPlan(
  [
    {
      id: 'accounts',
      name: 'accounts',
      position: { x: 0, y: 0 },
      columns: [{ id: 'accounts-id', name: 'id', order: 0 }],
    },
    {
      id: 'orders',
      name: 'orders',
      position: { x: 200, y: 0 },
      columns: [{ id: 'orders-account', name: 'account_id', order: 0 }],
    },
    {
      id: 'audit',
      name: 'audit',
      position: { x: 0, y: 300 },
      columns: [{ id: 'audit-id', name: 'id', order: 0 }],
    },
  ],
  [
    {
      id: 'orders-account',
      sourceTableId: 'orders',
      targetTableId: 'accounts',
      sourceColumnId: 'orders-account',
      targetColumnId: 'accounts-id',
    },
  ],
)

describe('SelectedTablesSqlDialog', () => {
  it('previews JOIN and independent SELECT blocks for a mixed selection', () => {
    render(
      <SelectedTablesSqlDialog
        plan={plan}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('generated-sql').textContent).toContain(
      'INNER JOIN "orders" AS "o"',
    )
    expect(screen.getByTestId('generated-sql').textContent).toContain(
      'FROM "audit" AS "a2"',
    )
    expect(screen.getByText(/Independent SELECTs: audit/)).toBeTruthy()
  })

  it('does not offer FULL OUTER JOIN for MySQL', () => {
    render(
      <SelectedTablesSqlDialog
        plan={plan}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('SQL dialect'))
    fireEvent.click(screen.getByRole('option', { name: 'MySQL' }))
    fireEvent.click(screen.getByLabelText(/JOIN type for orders-account/))

    expect(screen.queryByRole('option', { name: 'FULL OUTER' })).toBeNull()
  })
})
