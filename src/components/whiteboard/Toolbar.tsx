// src/components/whiteboard/Toolbar.tsx
// Toolbar component for whiteboard actions (Add Table, Add Relationship)

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DiagramTable, Column, Cardinality } from '@prisma/client';
import type { CreateTable, CreateRelationship } from '@/data/schema';

/**
 * Toolbar component props
 */
export interface ToolbarProps {
  /** Whiteboard ID for creating entities */
  whiteboardId: string;
  /** All tables in the whiteboard (for relationship dialog) */
  tables: Array<DiagramTable & { columns: Column[] }>;
  /** Callback when table is created */
  onCreateTable?: (data: CreateTable) => void | Promise<void>;
  /** Callback when relationship is created */
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<void>;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Data types available for columns
 */
const DATA_TYPES = [
  'int',
  'string',
  'float',
  'boolean',
  'date',
  'text',
  'uuid',
  'json',
] as const;

/**
 * Cardinality options for relationships
 */
const CARDINALITIES: Array<{ value: Cardinality; label: string }> = [
  { value: 'ONE_TO_ONE', label: 'One to One (1:1)' },
  { value: 'ONE_TO_MANY', label: 'One to Many (1:N)' },
  { value: 'MANY_TO_ONE', label: 'Many to One (N:1)' },
  { value: 'MANY_TO_MANY', label: 'Many to Many (N:N)' },
];

/**
 * Toolbar component for whiteboard actions
 *
 * Features:
 * - Add Table button with dialog
 * - Add Relationship button with dialog
 * - Table creation form (name, description, initial columns)
 * - Relationship creation form (source/target table + column selection, cardinality)
 *
 * @example
 * ```tsx
 * <Toolbar
 *   whiteboardId={whiteboardId}
 *   tables={tables}
 *   onCreateTable={handleCreateTable}
 *   onCreateRelationship={handleCreateRelationship}
 * />
 * ```
 */
export function Toolbar({
  whiteboardId,
  tables,
  onCreateTable,
  onCreateRelationship,
  className = '',
}: ToolbarProps) {
  // Table dialog state
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [tableDescription, setTableDescription] = useState('');

  // Relationship dialog state
  const [relationshipDialogOpen, setRelationshipDialogOpen] = useState(false);
  const [sourceTableId, setSourceTableId] = useState<string>('');
  const [targetTableId, setTargetTableId] = useState<string>('');
  const [sourceColumnId, setSourceColumnId] = useState<string>('');
  const [targetColumnId, setTargetColumnId] = useState<string>('');
  const [cardinality, setCardinality] = useState<Cardinality>('ONE_TO_MANY');
  const [relationshipLabel, setRelationshipLabel] = useState('');

  /**
   * Handle table creation
   */
  const handleCreateTable = async () => {
    if (!tableName.trim()) {
      alert('Table name is required');
      return;
    }

    // Create table at a default position (center of canvas)
    // In a real app, this might be based on canvas viewport or click position
    const tableData: CreateTable = {
      whiteboardId,
      name: tableName.trim(),
      description: tableDescription.trim() || undefined,
      positionX: 400, // Default position
      positionY: 300,
    };

    await onCreateTable?.(tableData);

    // Reset form and close dialog
    setTableName('');
    setTableDescription('');
    setTableDialogOpen(false);
  };

  /**
   * Handle relationship creation
   */
  const handleCreateRelationship = async () => {
    if (!sourceTableId || !targetTableId || !sourceColumnId || !targetColumnId) {
      alert('Please select source and target tables and columns');
      return;
    }

    const relationshipData: CreateRelationship = {
      whiteboardId,
      sourceTableId,
      targetTableId,
      sourceColumnId,
      targetColumnId,
      cardinality,
      label: relationshipLabel.trim() || undefined,
    };

    await onCreateRelationship?.(relationshipData);

    // Reset form and close dialog
    setSourceTableId('');
    setTargetTableId('');
    setSourceColumnId('');
    setTargetColumnId('');
    setCardinality('ONE_TO_MANY');
    setRelationshipLabel('');
    setRelationshipDialogOpen(false);
  };

  // Get columns for selected source table
  const sourceColumns =
    tables.find((t) => t.id === sourceTableId)?.columns ?? [];

  // Get columns for selected target table
  const targetColumns =
    tables.find((t) => t.id === targetTableId)?.columns ?? [];

  return (
    <div className={`flex gap-2 p-4 border-b bg-background ${className}`}>
      {/* Add Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="default">Add Table</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Table</DialogTitle>
            <DialogDescription>
              Add a new table to your ER diagram. You can add columns after
              creating the table.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="table-name">Table Name *</Label>
              <Input
                id="table-name"
                placeholder="e.g., Users"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateTable();
                  }
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="table-description">Description</Label>
              <Textarea
                id="table-description"
                placeholder="Optional description of the table..."
                value={tableDescription}
                onChange={(e) => setTableDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTableDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateTable}>
              Create Table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Relationship Dialog */}
      <Dialog
        open={relationshipDialogOpen}
        onOpenChange={setRelationshipDialogOpen}
      >
        <DialogTrigger asChild>
          <Button variant="default" disabled={tables.length < 2}>
            Add Relationship
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Relationship</DialogTitle>
            <DialogDescription>
              Define a relationship between two tables by selecting the source
              and target columns.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Source Table Selection */}
            <div className="grid gap-2">
              <Label htmlFor="source-table">Source Table *</Label>
              <Select value={sourceTableId} onValueChange={setSourceTableId}>
                <SelectTrigger id="source-table">
                  <SelectValue placeholder="Select source table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((table) => (
                    <SelectItem key={table.id} value={table.id}>
                      {table.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source Column Selection */}
            <div className="grid gap-2">
              <Label htmlFor="source-column">Source Column *</Label>
              <Select
                value={sourceColumnId}
                onValueChange={setSourceColumnId}
                disabled={!sourceTableId || sourceColumns.length === 0}
              >
                <SelectTrigger id="source-column">
                  <SelectValue placeholder="Select source column" />
                </SelectTrigger>
                <SelectContent>
                  {sourceColumns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name} ({column.dataType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Table Selection */}
            <div className="grid gap-2">
              <Label htmlFor="target-table">Target Table *</Label>
              <Select value={targetTableId} onValueChange={setTargetTableId}>
                <SelectTrigger id="target-table">
                  <SelectValue placeholder="Select target table" />
                </SelectTrigger>
                <SelectContent>
                  {tables
                    .filter((table) => table.id !== sourceTableId)
                    .map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Column Selection */}
            <div className="grid gap-2">
              <Label htmlFor="target-column">Target Column *</Label>
              <Select
                value={targetColumnId}
                onValueChange={setTargetColumnId}
                disabled={!targetTableId || targetColumns.length === 0}
              >
                <SelectTrigger id="target-column">
                  <SelectValue placeholder="Select target column" />
                </SelectTrigger>
                <SelectContent>
                  {targetColumns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name} ({column.dataType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cardinality Selection */}
            <div className="grid gap-2">
              <Label htmlFor="cardinality">Cardinality *</Label>
              <Select
                value={cardinality}
                onValueChange={(value) => setCardinality(value as Cardinality)}
              >
                <SelectTrigger id="cardinality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARDINALITIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Relationship Label */}
            <div className="grid gap-2">
              <Label htmlFor="rel-label">Label (Optional)</Label>
              <Input
                id="rel-label"
                placeholder="e.g., has, belongs to"
                value={relationshipLabel}
                onChange={(e) => setRelationshipLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRelationshipDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateRelationship}>
              Create Relationship
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Future: Add more toolbar actions */}
      {/* - Auto-layout button */}
      {/* - Zoom controls */}
      {/* - Export diagram */}
    </div>
  );
}
