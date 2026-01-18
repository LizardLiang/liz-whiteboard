import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TableNode } from './TableNode'
import type { TableNodeData } from '@/lib/react-flow/types'

// Wrapper to provide React Flow context
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
)

// Mock table data
const mockTableData: TableNodeData = {
  table: {
    id: 'table-1',
    name: 'Users',
    x: 0,
    y: 0,
    width: 250,
    whiteboardId: 'wb-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    columns: [
      {
        id: 'col-1',
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 0,
        tableId: 'table-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'col-2',
        name: 'email',
        dataType: 'varchar(255)',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 1,
        tableId: 'table-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'col-3',
        name: 'created_at',
        dataType: 'timestamp',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 2,
        tableId: 'table-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  },
  showMode: 'ALL_FIELDS',
  isActiveHighlighted: false,
  isHighlighted: false,
  isHovered: false,
}

describe('TableNode (Browser)', () => {
  it('renders the table name', () => {
    render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={mockTableData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
        />
      </Wrapper>
    )

    expect(screen.getByText('Users')).toBeInTheDocument()
  })

  it('renders all columns in ALL_FIELDS mode', () => {
    render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={mockTableData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
        />
      </Wrapper>
    )

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('created_at')).toBeInTheDocument()
  })

  it('renders primary key indicator', () => {
    render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={mockTableData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
        />
      </Wrapper>
    )

    // PK indicator should be present
    expect(screen.getByText('PK')).toBeInTheDocument()
  })

  it('renders data types for columns', () => {
    render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={mockTableData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
        />
      </Wrapper>
    )

    expect(screen.getByText('uuid')).toBeInTheDocument()
    expect(screen.getByText('varchar(255)')).toBeInTheDocument()
    expect(screen.getByText('timestamp')).toBeInTheDocument()
  })

  it('applies selected styling when selected', () => {
    const { container } = render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={mockTableData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={true}
        />
      </Wrapper>
    )

    const node = container.querySelector('.react-flow__node-erTable')
    expect(node).toHaveClass('selected')
  })

  it('renders only keys in KEY_ONLY mode', () => {
    const keysOnlyData = { ...mockTableData, showMode: 'KEY_ONLY' as const }

    render(
      <Wrapper>
        <TableNode
          id="node-1"
          data={keysOnlyData}
          type="erTable"
          dragging={false}
          zIndex={1}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
        />
      </Wrapper>
    )

    // Should show the id column (PK)
    expect(screen.getByText('id')).toBeInTheDocument()
    // Should NOT show non-key columns
    expect(screen.queryByText('created_at')).not.toBeInTheDocument()
  })
})
