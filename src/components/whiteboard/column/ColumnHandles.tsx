/**
 * ColumnHandles — the four React Flow connection handles for a single
 * column row (left source+target, right source+target). Extracted from
 * ColumnRow.tsx / TableNode.tsx's LodColumnRow so the fragile handle-id
 * wiring (edge routing/drag-to-connect keys off these exact ids) lives in
 * exactly one place instead of being duplicated between the two render
 * paths. Handles are `position: absolute`, so this can be rendered from a
 * single spot in the row regardless of where other row content sits.
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { createColumnHandleId } from '@/lib/react-flow/edge-routing'

export interface ColumnHandlesProps {
  tableId: string
  columnId: string
}

export const ColumnHandles = memo(({ tableId, columnId }: ColumnHandlesProps) => {
  return (
    <>
      <Handle
        type="source"
        position={Position.Left}
        id={createColumnHandleId(tableId, columnId, 'left', 'source')}
        className="nodrag"
        style={{ left: '-14px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={createColumnHandleId(tableId, columnId, 'left', 'target')}
        className="nodrag"
        style={{ left: '-14px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={createColumnHandleId(tableId, columnId, 'right', 'source')}
        className="nodrag"
        style={{ right: '-14px' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={createColumnHandleId(tableId, columnId, 'right', 'target')}
        className="nodrag"
        style={{ right: '-14px' }}
      />
    </>
  )
})

ColumnHandles.displayName = 'ColumnHandles'
