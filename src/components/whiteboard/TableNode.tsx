// src/components/whiteboard/TableNode.tsx
// Konva component for rendering a database table with columns

import { useRef, useEffect } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { DiagramTable, Column } from '@prisma/client';

/**
 * TableNode component props
 */
export interface TableNodeProps {
  /** Table data from database */
  table: DiagramTable & { columns: Column[] };
  /** Whether this table is selected */
  isSelected?: boolean;
  /** Callback when table is clicked */
  onClick?: (tableId: string) => void;
  /** Callback when table is dragged */
  onDragMove?: (tableId: string, x: number, y: number) => void;
  /** Callback when table drag ends */
  onDragEnd?: (tableId: string, x: number, y: number) => void;
  /** Theme (light or dark mode) */
  theme?: 'light' | 'dark';
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
  light: {
    headerBg: '#1a1a1a', // Very dark header (almost black)
    headerText: '#9ca3af', // Gray 400 - muted light text
    bodyBg: '#262626', // Dark gray body (slightly lighter than header)
    bodyText: '#d1d5db', // Gray 300 - light text
    border: '#404040', // Dark gray border
    selectedBorder: '#22c55e', // Green 500 - matches the green keys in reference
    shadow: 'rgba(0, 0, 0, 0.6)',
  },
  dark: {
    headerBg: '#1a1a1a', // Very dark header (almost black)
    headerText: '#9ca3af', // Gray 400 - muted light text
    bodyBg: '#262626', // Dark gray body (slightly lighter than header)
    bodyText: '#d1d5db', // Gray 300 - light text
    border: '#404040', // Dark gray border
    selectedBorder: '#22c55e', // Green 500 - matches the green keys in reference
    shadow: 'rgba(0, 0, 0, 0.6)',
  },
};

/**
 * Calculate column display text with type indicators
 * @param column - Column data
 * @returns Formatted column string with PK/FK indicators
 */
function formatColumnText(column: Column): string {
  let prefix = '';

  // Add primary key indicator
  if (column.isPrimaryKey) {
    prefix += '🔑 ';
  }
  // Add foreign key indicator
  else if (column.isForeignKey) {
    prefix += '🔗 ';
  }

  // Format: name: dataType (nullable/not null)
  const nullability = column.isNullable ? '' : ' NOT NULL';
  return `${prefix}${column.name}: ${column.dataType}${nullability}`;
}

/**
 * Calculate table dimensions based on content
 * @param table - Table data with columns
 * @param columnTexts - Formatted column texts
 * @returns Width and height for table
 */
function calculateTableDimensions(
  table: DiagramTable & { columns: Column[] },
  columnTexts: string[]
): { width: number; height: number } {
  // Calculate width based on longest text
  // Approximate: 7px per character (rough estimate for typical fonts)
  const headerWidth = table.name.length * 8 + TABLE_STYLE.padding * 2;
  const columnWidths = columnTexts.map(
    (text) => text.length * 7 + TABLE_STYLE.padding * 2
  );
  const maxColumnWidth = Math.max(...columnWidths, 0);
  const width = Math.max(
    TABLE_STYLE.minWidth,
    headerWidth,
    maxColumnWidth,
    table.width ?? 0
  );

  // Calculate height based on number of rows
  const height =
    TABLE_STYLE.headerHeight +
    table.columns.length * TABLE_STYLE.rowHeight +
    TABLE_STYLE.padding;

  return { width, height };
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
  theme = 'light',
}: TableNodeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const isDraggingRef = useRef(false);
  const colors = TABLE_STYLE[theme];

  // Format column texts
  const columnTexts = table.columns.map(formatColumnText);

  // Calculate dimensions
  const { width, height } = calculateTableDimensions(table, columnTexts);

  /**
   * Handle table click
   */
  const handleClick = () => {
    onClick?.(table.id);
  };

  /**
   * Handle drag start
   */
  const handleDragStart = () => {
    isDraggingRef.current = true;
  };

  /**
   * Handle drag move
   */
  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group;
    onDragMove?.(table.id, node.x(), node.y());
  };

  /**
   * Handle drag end
   */
  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group;
    isDraggingRef.current = false;
    onDragEnd?.(table.id, node.x(), node.y());
  };

  /**
   * Update group position when table position changes
   * Only update if not currently dragging to avoid conflicts
   */
  useEffect(() => {
    const group = groupRef.current;
    // Don't update position while dragging to avoid conflicts with Konva's drag handling
    if (!isDraggingRef.current && group && (group.x() !== table.positionX || group.y() !== table.positionY)) {
      group.position({ x: table.positionX, y: table.positionY });
      group.getLayer()?.batchDraw();
    }
  }, [table.positionX, table.positionY]);

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
      shadowColor={colors.shadow}
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
        fill={colors.bodyBg}
        stroke={isSelected ? colors.selectedBorder : colors.border}
        strokeWidth={isSelected ? TABLE_STYLE.borderWidth + 1 : TABLE_STYLE.borderWidth}
        cornerRadius={TABLE_STYLE.cornerRadius}
      />

      {/* Header background */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={TABLE_STYLE.headerHeight}
        fill={colors.headerBg}
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
        fill={colors.headerText}
        align="left"
        verticalAlign="middle"
        ellipsis={true}
      />

      {/* Separator line between header and body */}
      <Line
        points={[0, TABLE_STYLE.headerHeight, width, TABLE_STYLE.headerHeight]}
        stroke={colors.border}
        strokeWidth={1}
      />

      {/* Render columns */}
      {table.columns.map((column, index) => {
        const yPos =
          TABLE_STYLE.headerHeight +
          index * TABLE_STYLE.rowHeight +
          TABLE_STYLE.padding / 2;

        return (
          <Text
            key={column.id}
            x={TABLE_STYLE.padding}
            y={yPos}
            width={width - TABLE_STYLE.padding * 2}
            text={columnTexts[index]}
            fontSize={TABLE_STYLE.fontSize}
            fill={colors.bodyText}
            align="left"
            verticalAlign="top"
            ellipsis={true}
            // Slightly bolder for primary keys
            fontStyle={column.isPrimaryKey ? 'bold' : 'normal'}
          />
        );
      })}

      {/* Show description on hover (future enhancement) */}
      {table.description && (
        <Text
          x={TABLE_STYLE.padding}
          y={height - TABLE_STYLE.padding - 10}
          width={width - TABLE_STYLE.padding * 2}
          text={table.description}
          fontSize={10}
          fill={colors.bodyText}
          opacity={0.6}
          align="left"
          visible={false} // Hidden by default, show on hover
        />
      )}
    </Group>
  );
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
  table: DiagramTable & { columns: Column[] },
  columnIndex: number
): { x: number; y: number } {
  // Calculate column Y position (center of the column row)
  const yOffset =
    TABLE_STYLE.headerHeight +
    columnIndex * TABLE_STYLE.rowHeight +
    TABLE_STYLE.rowHeight / 2 +
    TABLE_STYLE.padding / 2;

  // Format texts to calculate width
  const columnTexts = table.columns.map(formatColumnText);
  const { width } = calculateTableDimensions(table, columnTexts);

  return {
    x: table.positionX + width, // Right edge of table
    y: table.positionY + yOffset,
  };
}

/**
 * Get the left edge position of a table for incoming relationships
 *
 * @param table - Table data with position
 * @param columnIndex - Index of the column
 * @returns { x, y } position of the column on the left edge
 */
export function getColumnPositionLeft(
  table: DiagramTable & { columns: Column[] },
  columnIndex: number
): { x: number; y: number } {
  const yOffset =
    TABLE_STYLE.headerHeight +
    columnIndex * TABLE_STYLE.rowHeight +
    TABLE_STYLE.rowHeight / 2 +
    TABLE_STYLE.padding / 2;

  return {
    x: table.positionX, // Left edge of table
    y: table.positionY + yOffset,
  };
}
