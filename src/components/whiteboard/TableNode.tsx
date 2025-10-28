// src/components/whiteboard/TableNode.tsx
// Konva component for rendering a database table with columns

import { useEffect, useRef } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Column, DiagramTable } from '@prisma/client'

/**
 * TableNode component props
 */
export interface TableNodeProps {
  /** Table data from database */
  table: DiagramTable & { columns: Array<Column> }
  /** Whether this table is selected */
  isSelected?: boolean
  /** Callback when table is clicked */
  onClick?: (tableId: string) => void
  /** Callback when table is dragged */
  onDragMove?: (tableId: string, x: number, y: number) => void
  /** Callback when table drag ends */
  onDragEnd?: (tableId: string, x: number, y: number) => void
}

/**
 * Get CSS variable value from document root
 * @param varName - CSS variable name (e.g., '--table-fill')
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
 * Visual constants for table rendering
 */
const TABLE_STYLE = {
  minWidth: 200,
  padding: 12,
  headerHeight: 40,
  rowHeight: 28,
  fontSize: 14,
  headerFontSize: 16,
  cornerRadius: 8,
  borderWidth: 2,
}

/**
 * Calculate column display text with type indicators
 * @param column - Column data
 * @returns Formatted column string with PK/FK indicators
 */
function formatColumnText(column: Column): string {
  let prefix = ''

  // Add primary key indicator
  if (column.isPrimaryKey) {
    prefix += '🔑 '
  }
  // Add foreign key indicator
  else if (column.isForeignKey) {
    prefix += '🔗 '
  }

  // Format: name: dataType (nullable/not null)
  const nullability = column.isNullable ? '' : ' NOT NULL'
  return `${prefix}${column.name}: ${column.dataType}${nullability}`
}

/**
 * Calculate table dimensions based on content
 * @param table - Table data with columns
 * @param columnTexts - Formatted column texts
 * @returns Width and height for table
 */
function calculateTableDimensions(
  table: DiagramTable & { columns: Array<Column> },
  columnTexts: Array<string>,
): { width: number; height: number } {
  // Calculate width based on longest text
  // Approximate: 7px per character (rough estimate for typical fonts)
  const headerWidth = table.name.length * 8 + TABLE_STYLE.padding * 2
  const columnWidths = columnTexts.map(
    (text) => text.length * 7 + TABLE_STYLE.padding * 2,
  )
  const maxColumnWidth = Math.max(...columnWidths, 0)
  const width = Math.max(
    TABLE_STYLE.minWidth,
    headerWidth,
    maxColumnWidth,
    table.width ?? 0,
  )

  // Calculate height based on number of rows
  const height =
    TABLE_STYLE.headerHeight +
    table.columns.length * TABLE_STYLE.rowHeight +
    TABLE_STYLE.padding

  return { width, height }
}

/**
 * TableNode component - renders a database table with draggable support
 *
 * Features:
 * - Header with table name
 * - Columns with data types
 * - Primary key (🔑) and foreign key (🔗) indicators
 * - Drag-and-drop support
 * - Theme-aware colors
 * - Selection highlighting
 *
 * @example
 * ```tsx
 * <TableNode
 *   table={table}
 *   isSelected={selectedTableId === table.id}
 *   onClick={(id) => setSelectedTableId(id)}
 *   onDragEnd={(id, x, y) => updateTablePosition(id, x, y)}
 *   theme="dark"
 * />
 * ```
 */
export function TableNode({
  table,
  isSelected = false,
  onClick,
  onDragMove,
  onDragEnd,
}: TableNodeProps) {
  const groupRef = useRef<Konva.Group>(null)
  const isDraggingRef = useRef(false)

  // Read theme-aware colors from CSS variables
  const tableFill = getCSSVariable('--table-fill', '#262626')
  const tableStroke = getCSSVariable('--table-stroke', '#404040')
  const tableHeaderBg = getCSSVariable('--table-header-bg', '#1a1a1a')
  const tableHeaderText = getCSSVariable('--table-header-text', '#9ca3af')
  const tableBodyText = getCSSVariable('--table-body-text', '#d1d5db')
  const tableSelectedBorder = getCSSVariable(
    '--table-selected-border',
    '#22c55e',
  )
  const tableShadow = getCSSVariable('--table-shadow', 'rgba(0, 0, 0, 0.6)')

  // Format column texts
  const columnTexts = table.columns.map(formatColumnText)

  // Calculate dimensions
  const { width, height } = calculateTableDimensions(table, columnTexts)

  /**
   * Handle table click
   */
  const handleClick = () => {
    onClick?.(table.id)
  }

  /**
   * Handle drag start
   */
  const handleDragStart = () => {
    isDraggingRef.current = true
  }

  /**
   * Handle drag move
   */
  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group
    onDragMove?.(table.id, node.x(), node.y())
  }

  /**
   * Handle drag end
   */
  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group
    isDraggingRef.current = false
    onDragEnd?.(table.id, node.x(), node.y())
  }

  /**
   * Update group position when table position changes
   * Uses smooth animation (Konva Tween) if position change is significant
   * Only update if not currently dragging to avoid conflicts
   */
  useEffect(() => {
    const group = groupRef.current
    if (isDraggingRef.current || !group) return

    const currentX = group.x()
    const currentY = group.y()
    const targetX = table.positionX
    const targetY = table.positionY

    // Check if position actually changed
    if (currentX === targetX && currentY === targetY) return

    // Calculate distance moved
    const distance = Math.sqrt(
      Math.pow(targetX - currentX, 2) + Math.pow(targetY - currentY, 2),
    )

    // Use animation for significant moves (likely from auto-layout)
    // Use instant update for small moves (likely from manual drag)
    if (distance > 50) {
      // Animate to new position
      const tween = new (window as any).Konva.Tween({
        node: group,
        duration: 0.5, // 500ms
        x: targetX,
        y: targetY,
        easing: (window as any).Konva.Easings.EaseInOut,
        onFinish: () => {
          group.getLayer()?.batchDraw()
        },
      })
      tween.play()
    } else {
      // Instant update for small moves
      group.position({ x: targetX, y: targetY })
      group.getLayer()?.batchDraw()
    }
  }, [table.positionX, table.positionY])

  return (
    <Group
      ref={groupRef}
      x={table.positionX}
      y={table.positionY}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      // Add shadow for depth
      shadowColor={tableShadow}
      shadowBlur={isSelected ? 20 : 10}
      shadowOpacity={isSelected ? 0.5 : 0.3}
      shadowOffsetX={0}
      shadowOffsetY={4}
    >
      {/* Table border/background */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={tableFill}
        stroke={isSelected ? tableSelectedBorder : tableStroke}
        strokeWidth={
          isSelected ? TABLE_STYLE.borderWidth + 1 : TABLE_STYLE.borderWidth
        }
        cornerRadius={TABLE_STYLE.cornerRadius}
      />

      {/* Header background */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={TABLE_STYLE.headerHeight}
        fill={tableHeaderBg}
        cornerRadius={[
          TABLE_STYLE.cornerRadius,
          TABLE_STYLE.cornerRadius,
          0,
          0,
        ]}
      />

      {/* Table name */}
      <Text
        x={TABLE_STYLE.padding}
        y={TABLE_STYLE.headerHeight / 2 - TABLE_STYLE.headerFontSize / 2}
        width={width - TABLE_STYLE.padding * 2}
        text={table.name}
        fontSize={TABLE_STYLE.headerFontSize}
        fontStyle={'bold'}
        fill={tableHeaderText}
        align="left"
        verticalAlign="middle"
        ellipsis={true}
      />

      {/* Separator line between header and body */}
      <Line
        points={[0, TABLE_STYLE.headerHeight, width, TABLE_STYLE.headerHeight]}
        stroke={tableStroke}
        strokeWidth={1}
      />

      {/* Render columns */}
      {table.columns.map((column, index) => {
        const yPos =
          TABLE_STYLE.headerHeight +
          index * TABLE_STYLE.rowHeight +
          TABLE_STYLE.padding / 2

        return (
          <Text
            key={column.id}
            x={TABLE_STYLE.padding}
            y={yPos}
            width={width - TABLE_STYLE.padding * 2}
            text={columnTexts[index]}
            fontSize={TABLE_STYLE.fontSize}
            fill={tableBodyText}
            align="left"
            verticalAlign="top"
            ellipsis={true}
            // Slightly bolder for primary keys
            fontStyle={column.isPrimaryKey ? 'bold' : 'normal'}
          />
        )
      })}

      {/* Show description on hover (future enhancement) */}
      {table.description && (
        <Text
          x={TABLE_STYLE.padding}
          y={height - TABLE_STYLE.padding - 10}
          width={width - TABLE_STYLE.padding * 2}
          text={table.description}
          fontSize={10}
          fill={tableBodyText}
          opacity={0.6}
          align="left"
          visible={false} // Hidden by default, show on hover
        />
      )}
    </Group>
  )
}

/**
 * Get the position of a specific column within a table node
 * Used for precise relationship arrow targeting
 *
 * @param table - Table data with position
 * @param columnIndex - Index of the column
 * @returns { x, y } position of the column center point
 */
export function getColumnPosition(
  table: DiagramTable & { columns: Array<Column> },
  columnIndex: number,
): { x: number; y: number } {
  // Calculate column Y position (center of the column row)
  const yOffset =
    TABLE_STYLE.headerHeight +
    columnIndex * TABLE_STYLE.rowHeight +
    TABLE_STYLE.rowHeight / 2 +
    TABLE_STYLE.padding / 2

  // Format texts to calculate width
  const columnTexts = table.columns.map(formatColumnText)
  const { width } = calculateTableDimensions(table, columnTexts)

  return {
    x: table.positionX + width, // Right edge of table
    y: table.positionY + yOffset,
  }
}

/**
 * Get the left edge position of a table for incoming relationships
 *
 * @param table - Table data with position
 * @param columnIndex - Index of the column
 * @returns { x, y } position of the column on the left edge
 */
export function getColumnPositionLeft(
  table: DiagramTable & { columns: Array<Column> },
  columnIndex: number,
): { x: number; y: number } {
  const yOffset =
    TABLE_STYLE.headerHeight +
    columnIndex * TABLE_STYLE.rowHeight +
    TABLE_STYLE.rowHeight / 2 +
    TABLE_STYLE.padding / 2

  return {
    x: table.positionX, // Left edge of table
    y: table.positionY + yOffset,
  }
}
