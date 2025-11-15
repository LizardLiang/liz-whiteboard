// ============================================================================
// Handle ID Management
// ============================================================================

/**
 * Generate a unique handle ID for a column
 * @param columnId - The column's unique ID
 * @param type - 'source' (right side) or 'target' (left side)
 * @returns Handle ID in format: {columnId}-{type}
 */
export function generateHandleId(columnId: string, type: 'source' | 'target'): string {
  return `${columnId}-${type}`;
}

/**
 * Parse a handle ID back into its components
 * @param handleId - Handle ID in format: {columnId}-{type}
 * @returns Object with columnId and type
 */
export function parseHandleId(handleId: string): { columnId: string; type: 'source' | 'target' } {
  const lastDashIndex = handleId.lastIndexOf('-');
  const columnId = handleId.substring(0, lastDashIndex);
  const type = handleId.substring(lastDashIndex + 1) as 'source' | 'target';

  return { columnId, type };
}

// ============================================================================
// Handle Position Calculation
// ============================================================================

/**
 * Calculate the vertical position of a handle based on column index
 * @param columnIndex - Zero-based index of the column in the table
 * @param headerHeight - Height of the table header in pixels (default: 40)
 * @param rowHeight - Height of each column row in pixels (default: 28)
 * @returns Y-position in pixels from the top of the node
 */
export function calculateHandlePosition(
  columnIndex: number,
  headerHeight: number = 40,
  rowHeight: number = 28
): number {
  // Position handle at vertical center of column row
  return headerHeight + (columnIndex * rowHeight) + (rowHeight / 2);
}

/**
 * Calculate handle style object for React Flow Handle component
 * @param columnIndex - Zero-based index of the column
 * @param headerHeight - Height of the table header (default: 40)
 * @param rowHeight - Height of each row (default: 28)
 * @returns Style object with top position
 */
export function getHandleStyle(
  columnIndex: number,
  headerHeight: number = 40,
  rowHeight: number = 28
): { top: string } {
  const topPx = calculateHandlePosition(columnIndex, headerHeight, rowHeight);
  return { top: `${topPx}px` };
}
