// src/components/whiteboard/RelationshipEdge.tsx
// Konva component for rendering relationships between tables with cardinality notation

import { Arrow, Circle, Group, Line, Text } from 'react-konva'
import { getColumnPosition, getColumnPositionLeft } from './TableNode'
import type {
  Cardinality,
  Column,
  DiagramTable,
  Relationship,
} from '@prisma/client'

/**
 * RelationshipEdge component props
 */
export interface RelationshipEdgeProps {
  /** Relationship data */
  relationship: Relationship
  /** Source table with columns */
  sourceTable: DiagramTable & { columns: Array<Column> }
  /** Target table with columns */
  targetTable: DiagramTable & { columns: Array<Column> }
  /** Whether this relationship is selected */
  isSelected?: boolean
  /** Callback when relationship is clicked */
  onClick?: (relationshipId: string) => void
}

/**
 * Get CSS variable value from document root
 * @param varName - CSS variable name (e.g., '--relationship-stroke')
 * @param fallback - Fallback value if variable not found
 * @returns Color value
 */
function getCSSVariable(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  try {
    const root = document.documentElement
    const value = getComputedStyle(root).getPropertyValue(varName).trim()
    return value || fallback
  } catch (error) {
    console.error(`Failed to read CSS variable ${varName}:`, error)
    return fallback
  }
}

/**
 * Visual constants for relationship rendering
 */
const RELATIONSHIP_STYLE = {
  strokeWidth: 2,
  selectedStrokeWidth: 3,
  arrowSize: 12,
  fontSize: 12,
  labelOffsetY: -10,
  cardinalityOffsetX: 20,
  cardinalityOffsetY: -15,
  crowFootSize: 12,
}

/**
 * Calculate the angle between two points (in radians)
 * @param x1 - Start X
 * @param y1 - Start Y
 * @param x2 - End X
 * @param y2 - End Y
 * @returns Angle in radians
 */
function calculateAngle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return Math.atan2(y2 - y1, x2 - x1)
}

/**
 * Calculate crow's foot notation points for many side
 * @param x - Position X
 * @param y - Position Y
 * @param angle - Arrow angle in radians
 * @param size - Size of the crow's foot
 * @returns Array of points for crow's foot lines
 */
function calculateCrowFootPoints(
  x: number,
  y: number,
  angle: number,
  size: number,
): Array<Array<number>> {
  const perpAngle1 = angle + Math.PI / 6 // 30 degrees
  const perpAngle2 = angle - Math.PI / 6

  // Three prongs of crow's foot
  const prong1 = [
    x,
    y,
    x - size * Math.cos(perpAngle1),
    y - size * Math.sin(perpAngle1),
  ]
  const prong2 = [x, y, x - size * Math.cos(angle), y - size * Math.sin(angle)]
  const prong3 = [
    x,
    y,
    x - size * Math.cos(perpAngle2),
    y - size * Math.sin(perpAngle2),
  ]

  return [prong1, prong2, prong3]
}

/**
 * Get cardinality display text
 * @param cardinality - Cardinality enum value
 * @returns Display text for cardinality
 */
export function getCardinalityText(cardinality: Cardinality): {
  source: string
  target: string
} {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return { source: '1', target: '1' }
    case 'ONE_TO_MANY':
      return { source: '1', target: 'N' }
    case 'MANY_TO_ONE':
      return { source: 'N', target: '1' }
    case 'MANY_TO_MANY':
      return { source: 'N', target: 'N' }
    case 'ZERO_TO_ONE':
      return { source: '0', target: '1' }
    case 'ZERO_TO_MANY':
      return { source: '0', target: 'N' }
    case 'SELF_REFERENCING':
      return { source: '1', target: 'N' }
    default:
      return { source: '', target: '' }
  }
}

/**
 * RelationshipEdge component - renders a relationship arrow with cardinality notation
 *
 * Features:
 * - Arrow from source to target table column
 * - Cardinality notation (1, N) near endpoints
 * - Crow's foot notation for "many" relationships
 * - Optional label text
 * - Theme-aware colors
 * - Selection highlighting
 *
 * Cardinality rendering:
 * - ONE_TO_ONE: 1——1
 * - ONE_TO_MANY: 1——<N (crow's foot at target)
 * - MANY_TO_ONE: N>——1 (crow's foot at source)
 * - MANY_TO_MANY: N>——<N (crow's foot at both ends)
 *
 * @example
 * ```tsx
 * <RelationshipEdge
 *   relationship={relationship}
 *   sourceTable={sourceTable}
 *   targetTable={targetTable}
 *   isSelected={selectedRelId === relationship.id}
 *   onClick={(id) => setSelectedRelId(id)}
 *   theme="dark"
 * />
 * ```
 */
export function RelationshipEdge({
  relationship,
  sourceTable,
  targetTable,
  isSelected = false,
  onClick,
}: RelationshipEdgeProps) {
  // Read theme-aware colors from CSS variables
  const relationshipStroke = getCSSVariable('--relationship-stroke', '#525252')
  const relationshipSelectedStroke = getCSSVariable(
    '--relationship-selected-stroke',
    '#22c55e',
  )
  const relationshipText = getCSSVariable('--relationship-text', '#a3a3a3')
  const relationshipSelectedText = getCSSVariable(
    '--relationship-selected-text',
    '#22c55e',
  )
  const relationshipCircleBg = getCSSVariable(
    '--relationship-circle-bg',
    '#1a1a1a',
  )

  // Find column indices in their respective tables
  const sourceColumnIndex = sourceTable.columns.findIndex(
    (col) => col.id === relationship.sourceColumnId,
  )
  const targetColumnIndex = targetTable.columns.findIndex(
    (col) => col.id === relationship.targetColumnId,
  )

  if (sourceColumnIndex === -1 || targetColumnIndex === -1) {
    console.error(
      'Column not found in table for relationship:',
      relationship.id,
    )
    return null
  }

  // Get precise column positions
  const sourcePos = getColumnPosition(sourceTable, sourceColumnIndex)
  const targetPos = getColumnPositionLeft(targetTable, targetColumnIndex)

  // Calculate arrow angle
  const angle = calculateAngle(
    sourcePos.x,
    sourcePos.y,
    targetPos.x,
    targetPos.y,
  )

  // Calculate midpoint for label
  const midX = (sourcePos.x + targetPos.x) / 2
  const midY = (sourcePos.y + targetPos.y) / 2

  // Get cardinality text
  const cardinalityText = getCardinalityText(relationship.cardinality)

  // Determine if we need crow's foot at source or target
  const showSourceCrowFoot =
    relationship.cardinality === 'MANY_TO_ONE' ||
    relationship.cardinality === 'MANY_TO_MANY'
  const showTargetCrowFoot =
    relationship.cardinality === 'ONE_TO_MANY' ||
    relationship.cardinality === 'MANY_TO_MANY'

  /**
   * Handle relationship click
   */
  const handleClick = () => {
    onClick?.(relationship.id)
  }

  return (
    <Group onClick={handleClick} onTap={handleClick}>
      {/* Main arrow line */}
      <Arrow
        points={[sourcePos.x, sourcePos.y, targetPos.x, targetPos.y]}
        stroke={isSelected ? relationshipSelectedStroke : relationshipStroke}
        strokeWidth={
          isSelected
            ? RELATIONSHIP_STYLE.selectedStrokeWidth
            : RELATIONSHIP_STYLE.strokeWidth
        }
        fill={isSelected ? relationshipSelectedStroke : relationshipStroke}
        pointerLength={showTargetCrowFoot ? 0 : RELATIONSHIP_STYLE.arrowSize}
        pointerWidth={showTargetCrowFoot ? 0 : RELATIONSHIP_STYLE.arrowSize}
        // Make it easier to click
        hitStrokeWidth={20}
      />

      {/* Crow's foot at source (for MANY_TO_ONE, MANY_TO_MANY) */}
      {showSourceCrowFoot &&
        calculateCrowFootPoints(
          sourcePos.x,
          sourcePos.y,
          angle + Math.PI, // Reverse angle for source end
          RELATIONSHIP_STYLE.crowFootSize,
        ).map((points, index) => (
          <Line
            key={`source-crow-${index}`}
            points={points}
            stroke={
              isSelected ? relationshipSelectedStroke : relationshipStroke
            }
            strokeWidth={RELATIONSHIP_STYLE.strokeWidth}
          />
        ))}

      {/* Crow's foot at target (for ONE_TO_MANY, MANY_TO_MANY) */}
      {showTargetCrowFoot &&
        calculateCrowFootPoints(
          targetPos.x,
          targetPos.y,
          angle,
          RELATIONSHIP_STYLE.crowFootSize,
        ).map((points, index) => (
          <Line
            key={`target-crow-${index}`}
            points={points}
            stroke={
              isSelected ? relationshipSelectedStroke : relationshipStroke
            }
            strokeWidth={RELATIONSHIP_STYLE.strokeWidth}
          />
        ))}

      {/* Cardinality text at source */}
      {cardinalityText.source && (
        <Group>
          <Circle
            x={sourcePos.x + RELATIONSHIP_STYLE.cardinalityOffsetX}
            y={sourcePos.y + RELATIONSHIP_STYLE.cardinalityOffsetY}
            radius={10}
            fill={relationshipCircleBg}
            stroke={
              isSelected ? relationshipSelectedStroke : relationshipStroke
            }
            strokeWidth={1}
          />
          <Text
            x={sourcePos.x + RELATIONSHIP_STYLE.cardinalityOffsetX - 5}
            y={sourcePos.y + RELATIONSHIP_STYLE.cardinalityOffsetY - 6}
            text={cardinalityText.source}
            fontSize={RELATIONSHIP_STYLE.fontSize}
            fill={isSelected ? relationshipSelectedText : relationshipText}
            fontStyle="bold"
          />
        </Group>
      )}

      {/* Cardinality text at target */}
      {cardinalityText.target && (
        <Group>
          <Circle
            x={targetPos.x - RELATIONSHIP_STYLE.cardinalityOffsetX}
            y={targetPos.y + RELATIONSHIP_STYLE.cardinalityOffsetY}
            radius={10}
            fill={relationshipCircleBg}
            stroke={
              isSelected ? relationshipSelectedStroke : relationshipStroke
            }
            strokeWidth={1}
          />
          <Text
            x={targetPos.x - RELATIONSHIP_STYLE.cardinalityOffsetX - 5}
            y={targetPos.y + RELATIONSHIP_STYLE.cardinalityOffsetY - 6}
            text={cardinalityText.target}
            fontSize={RELATIONSHIP_STYLE.fontSize}
            fill={isSelected ? relationshipSelectedText : relationshipText}
            fontStyle="bold"
          />
        </Group>
      )}

      {/* Relationship label (if provided) */}
      {relationship.label && (
        <Group>
          <Circle
            x={midX}
            y={midY + RELATIONSHIP_STYLE.labelOffsetY}
            radius={6}
            fill={relationshipCircleBg}
            stroke={
              isSelected ? relationshipSelectedStroke : relationshipStroke
            }
            strokeWidth={1}
          />
          <Text
            x={
              midX -
              (relationship.label.length * RELATIONSHIP_STYLE.fontSize) / 3
            }
            y={midY + RELATIONSHIP_STYLE.labelOffsetY - 20}
            text={relationship.label}
            fontSize={RELATIONSHIP_STYLE.fontSize}
            fill={isSelected ? relationshipSelectedText : relationshipText}
            padding={4}
            // Background for readability
            shadowColor={relationshipCircleBg}
            shadowBlur={8}
            shadowOpacity={0.8}
          />
        </Group>
      )}
    </Group>
  )
}
