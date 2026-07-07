// src/components/whiteboard/Toolbar.tsx
// Toolbar component for whiteboard actions (Add Table, Add Relationship, Auto Layout)

import { useState } from 'react'
import {
  Download,
  HelpCircle,
  History,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { ExportImageDialog } from './ExportImageDialog'
import { ImportSqlDialog } from './ImportSqlDialog'
import type { ExportImageDialogOptions } from './ExportImageDialog'
import type { Column, DiagramTable } from '@/data/models'
import type {
  Cardinality,
  CreateRelationship,
  CreateTable,
} from '@/data/schema'
import type { ShowMode } from '@/lib/react-flow/types'
import type { EffectiveRole } from '@/data/permission'
import type { DiagramAST } from '@/lib/parser/ast'
import { Badge } from '@/components/ui/badge'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Canvas zoom controls
 */
export interface ZoomControls {
  /** Zoom in by one step */
  zoomIn: () => void
  /** Zoom out by one step */
  zoomOut: () => void
  /** Reset zoom to 100% */
  resetZoom: () => void
  /** Fit all content to viewport */
  fitToScreen: () => void
}

/**
 * Toolbar component props
 */
export interface ToolbarProps {
  /** Whiteboard ID for creating entities */
  whiteboardId: string
  /** All tables in the whiteboard (for relationship dialog) */
  tables: Array<DiagramTable & { columns: Array<Column> }>
  /** Callback when table is created. Should reject on failure — Toolbar
   * keeps the dialog open and re-throws so callers can surface a toast. */
  onCreateTable?: (data: CreateTable) => void | Promise<unknown>
  /** Callback when relationship is created. Should reject on failure —
   * Toolbar keeps the dialog open and re-throws so callers can surface a toast. */
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<unknown>
  /** Total number of tables — drives the Auto Layout button enable/disable guard */
  tableCount: number
  /** Callback when the Auto Layout button is clicked */
  onAutoLayoutClick?: () => void | Promise<void>
  /** Whether auto layout is currently running */
  isAutoLayoutRunning?: boolean
  /** Canvas zoom controls */
  zoomControls?: ZoomControls
  /** Current zoom level (0-5) for display */
  currentZoom?: number
  /** Current display mode */
  showMode?: ShowMode
  /** Callback when display mode changes */
  onShowModeChange?: (mode: ShowMode) => void
  /** Callback to enter zen mode (hides all chrome). When omitted, no zen button is rendered. */
  onZenModeToggle?: () => void
  /** Callback to open the Cmd/Ctrl+K search palette. When omitted, no search button is rendered. */
  onOpenSearch?: () => void
  /** Callback to open the version history panel (GH #107). When omitted, no
   * History button is rendered. Visible to VIEWER+ — the panel itself gates
   * Save/Restore to EDITOR+ internally. */
  onOpenHistory?: () => void
  /** Callback to open the canvas comments panel (GH #110). When omitted, no
   * Comments button is rendered. Visible to VIEWER+ (comments are a
   * VIEWER+ affordance, independent of the write-gated buttons above). */
  onOpenComments?: () => void
  /** Count of unresolved comment threads (GH #110) — shown as a badge on
   * the Comments button when > 0. */
  commentUnreadCount?: number
  /** MCP endpoint URL — when provided, a Copy-MCP-URL button is rendered */
  mcpEndpointUrl?: string
  /** Callback when the user confirms an export in the Export dialog. When
   * omitted, no Export button is rendered. Rejection is caught here and
   * surfaced as an error toast — the dialog itself only manages its own
   * loading state. */
  onExport?: (opts: ExportImageDialogOptions) => void | Promise<void>
  /** Whether export is currently possible — false when the diagram has 0
   * tables. Disables the Export button with an explanatory tooltip. */
  canExport?: boolean
  /** Called with the parsed AST when the user confirms Import in the Import
   * SQL dialog. When omitted, no Import SQL button is rendered. Rejection is
   * caught by the dialog itself (keeps it open so the user can retry). */
  onImportSql?: (ast: DiagramAST) => void | Promise<void>
  /** Requesting user's effective role on the whiteboard's project. When
   * below EDITOR, write affordances (Add Table, Add Relationship) are
   * disabled — server-side enforcement already blocks the underlying
   * mutations; this is UX-only. Omitted/undefined is treated as full access
   * for backward compatibility with existing callers that don't pass it. */
  viewerRole?: EffectiveRole | null
  /** Optional CSS class name */
  className?: string
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
] as const

/**
 * Cardinality options for relationships
 */
export const CARDINALITIES: Array<{ value: Cardinality; label: string }> = [
  { value: 'ONE_TO_ONE', label: 'One to One (1:1)' },
  { value: 'ONE_TO_MANY', label: 'One to Many (1:N)' },
  { value: 'MANY_TO_ONE', label: 'Many to One (N:1)' },
  { value: 'MANY_TO_MANY', label: 'Many to Many (N:N)' },
  { value: 'ZERO_TO_ONE', label: 'Zero or One (0..1)' },
  { value: 'ZERO_TO_MANY', label: 'Zero or Many (0..N)' },
  { value: 'SELF_REFERENCING', label: 'Self Referencing' },
  { value: 'MANY_TO_ZERO_OR_ONE', label: 'Many to Zero or One (N:0..1)' },
  { value: 'MANY_TO_ZERO_OR_MANY', label: 'Many to Zero or Many (N:0..N)' },
  { value: 'ZERO_OR_ONE_TO_ONE', label: 'Zero or One to One (0..1:1)' },
  { value: 'ZERO_OR_ONE_TO_MANY', label: 'Zero or One to Many (0..1:N)' },
  {
    value: 'ZERO_OR_ONE_TO_ZERO_OR_ONE',
    label: 'Zero or One to Zero or One (0..1:0..1)',
  },
  {
    value: 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
    label: 'Zero or One to Zero or Many (0..1:0..N)',
  },
  { value: 'ZERO_OR_MANY_TO_ONE', label: 'Zero or Many to One (0..N:1)' },
  { value: 'ZERO_OR_MANY_TO_MANY', label: 'Zero or Many to Many (0..N:N)' },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
    label: 'Zero or Many to Zero or One (0..N:0..1)',
  },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
    label: 'Zero or Many to Zero or Many (0..N:0..N)',
  },
]

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
  tableCount,
  onAutoLayoutClick,
  isAutoLayoutRunning = false,
  zoomControls,
  currentZoom = 1,
  showMode = 'ALL_FIELDS',
  onShowModeChange,
  onZenModeToggle,
  onOpenSearch,
  onOpenHistory,
  onOpenComments,
  commentUnreadCount = 0,
  mcpEndpointUrl,
  onExport,
  canExport = false,
  onImportSql,
  viewerRole,
  className = '',
}: ToolbarProps) {
  // Write affordances (Add Table, Add Relationship, Import SQL) require EDITOR+.
  // viewerRole === undefined means the caller didn't opt into role gating —
  // treated as full access for backward compatibility with existing callers.
  const canEdit =
    viewerRole === undefined || hasMinimumRole(viewerRole, 'EDITOR')

  // Help dialog state
  const [helpOpen, setHelpOpen] = useState(false)

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // Import SQL dialog state
  const [importSqlOpen, setImportSqlOpen] = useState(false)

  // Table dialog state
  const [tableDialogOpen, setTableDialogOpen] = useState(false)
  const [tableName, setTableName] = useState('')
  const [tableDescription, setTableDescription] = useState('')

  // Relationship dialog state
  const [relationshipDialogOpen, setRelationshipDialogOpen] = useState(false)
  const [sourceTableId, setSourceTableId] = useState<string>('')
  const [targetTableId, setTargetTableId] = useState<string>('')
  const [sourceColumnId, setSourceColumnId] = useState<string>('')
  const [targetColumnId, setTargetColumnId] = useState<string>('')
  const [cardinality, setCardinality] = useState<Cardinality>('ONE_TO_MANY')
  const [relationshipLabel, setRelationshipLabel] = useState('')

  /**
   * Handle table creation
   */
  const handleCreateTable = async () => {
    if (!tableName.trim()) {
      alert('Table name is required')
      return
    }

    // Create table at a default position (center of canvas)
    // In a real app, this might be based on canvas viewport or click position
    const tableData: CreateTable = {
      whiteboardId,
      name: tableName.trim(),
      description: tableDescription.trim() || undefined,
      positionX: 400, // Default position
      positionY: 300,
    }

    try {
      await onCreateTable?.(tableData)
    } catch {
      // Rejection is re-thrown by the caller's mutateAsync — the mutation's
      // own onError handler surfaces the user-facing toast. Keep the dialog
      // open so the user doesn't lose their input and can retry or cancel.
      return
    }

    // Reset form and close dialog — only on success
    setTableName('')
    setTableDescription('')
    setTableDialogOpen(false)
  }

  /**
   * Handle relationship creation
   */
  const handleCreateRelationship = async () => {
    if (
      !sourceTableId ||
      !targetTableId ||
      !sourceColumnId ||
      !targetColumnId
    ) {
      alert('Please select source and target tables and columns')
      return
    }

    const relationshipData: CreateRelationship = {
      whiteboardId,
      sourceTableId,
      targetTableId,
      sourceColumnId,
      targetColumnId,
      cardinality,
      label: relationshipLabel.trim() || undefined,
    }

    try {
      await onCreateRelationship?.(relationshipData)
    } catch {
      // Rejection is re-thrown by the caller's mutateAsync — the mutation's
      // own onError handler surfaces the user-facing toast. Keep the dialog
      // open so the user doesn't lose their input and can retry or cancel.
      return
    }

    // Reset form and close dialog — only on success
    setSourceTableId('')
    setTargetTableId('')
    setSourceColumnId('')
    setTargetColumnId('')
    setCardinality('ONE_TO_MANY')
    setRelationshipLabel('')
    setRelationshipDialogOpen(false)
  }

  // Get columns for selected source table
  const sourceColumns =
    tables.find((t) => t.id === sourceTableId)?.columns ?? []

  // Get columns for selected target table
  const targetColumns =
    tables.find((t) => t.id === targetTableId)?.columns ?? []

  return (
    <div
      className={`flex items-center gap-2 p-4 border-b bg-background ${className}`}
    >
      {/* Add Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="default"
            disabled={!canEdit}
            title={
              canEdit
                ? undefined
                : 'You have view-only access to this whiteboard.'
            }
          >
            Add Table
          </Button>
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
                    handleCreateTable()
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
          <Button
            variant="default"
            disabled={tables.length < 2 || !canEdit}
            title={
              !canEdit
                ? 'You have view-only access to this whiteboard.'
                : undefined
            }
          >
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

      {/* Import SQL — paste CREATE TABLE DDL to generate tables/columns/relationships */}
      {onImportSql && (
        <>
          <Button
            variant="outline"
            disabled={!canEdit}
            title={
              canEdit
                ? undefined
                : 'You have view-only access to this whiteboard.'
            }
            onClick={() => setImportSqlOpen(true)}
          >
            Import SQL
          </Button>
          <ImportSqlDialog
            open={importSqlOpen}
            onOpenChange={setImportSqlOpen}
            onImport={onImportSql}
          />
        </>
      )}

      {/* Auto Layout Button */}
      {/* Wrap in a span so the tooltip works even when the button is disabled
          (a disabled button does not fire mouse events in all browsers). */}
      <span
        title={
          tableCount < 2
            ? 'Add at least 2 tables to use Auto Layout'
            : tableCount > 50
              ? 'Layout cannot be cancelled once started.'
              : 'Automatically arrange tables based on FK relationships.'
        }
      >
        <Button
          variant="outline"
          disabled={tableCount < 2 || isAutoLayoutRunning}
          onClick={() => void onAutoLayoutClick?.()}
        >
          {isAutoLayoutRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running…
            </>
          ) : (
            'Auto Layout'
          )}
        </Button>
      </span>

      {/* Display Mode Toggle */}
      {onShowModeChange && (
        <div className="flex items-center gap-2 border-l pl-4">
          <Label className="text-sm text-muted-foreground">Display:</Label>
          <div className="flex items-center gap-1">
            <Button
              variant={showMode === 'TABLE_NAME' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onShowModeChange('TABLE_NAME')}
              title="Show table names only"
            >
              Compact
            </Button>
            <Button
              variant={showMode === 'KEY_ONLY' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onShowModeChange('KEY_ONLY')}
              title="Show table names and primary/foreign keys"
            >
              Keys
            </Button>
            <Button
              variant={showMode === 'ALL_FIELDS' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onShowModeChange('ALL_FIELDS')}
              title="Show all columns"
            >
              All
            </Button>
          </div>
        </div>
      )}

      {/* Spacer to push zoom controls to the right */}
      <div className="flex-1" />

      {/* Zoom Controls */}
      {zoomControls && (
        <div className="flex items-center gap-2">
          {/* Zoom Out */}
          <Button
            variant="outline"
            size="icon"
            onClick={zoomControls.zoomOut}
            disabled={currentZoom <= 0.1}
            title="Zoom Out (Ctrl/Cmd + -)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </Button>

          {/* Zoom Level Display */}
          <div className="flex items-center justify-center min-w-[60px] px-2 py-1 text-sm font-medium text-muted-foreground">
            {Math.round(currentZoom * 100)}%
          </div>

          {/* Zoom In */}
          <Button
            variant="outline"
            size="icon"
            onClick={zoomControls.zoomIn}
            disabled={currentZoom >= 5}
            title="Zoom In (Ctrl/Cmd + +)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </Button>

          {/* Fit to Screen */}
          <Button
            variant="outline"
            size="icon"
            onClick={zoomControls.fitToScreen}
            title="Fit to Screen"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </Button>

          {/* Reset Zoom */}
          <Button
            variant="outline"
            size="icon"
            onClick={zoomControls.resetZoom}
            title="Reset Zoom (Ctrl/Cmd + 0)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </Button>
        </div>
      )}

      {/* Help button — keyboard shortcuts reference */}
      <div className="border-l pl-2 flex items-center gap-1">
        {onOpenSearch && (
          <Button
            variant="outline"
            size="icon"
            title="Search tables and columns (Ctrl/Cmd+K)"
            onClick={onOpenSearch}
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" title="Keyboard shortcuts">
              <HelpCircle className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Keyboard Shortcuts</DialogTitle>
            </DialogHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium text-muted-foreground">
                    Key
                  </th>
                  <th className="py-2 text-left font-medium text-muted-foreground">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Ctrl/Cmd
                    </kbd>
                    {' + '}
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      K
                    </kbd>
                  </td>
                  <td className="py-2">Search tables and columns</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      z
                    </kbd>
                  </td>
                  <td className="py-2">Toggle Zen Mode</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      f
                    </kbd>
                  </td>
                  <td className="py-2">Open Focus Overlay on selected table</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      m
                    </kbd>
                  </td>
                  <td className="py-2">Expand/focus the minimap</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Delete
                    </kbd>
                    {' / '}
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Backspace
                    </kbd>
                  </td>
                  <td className="py-2">Delete selected table</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Ctrl/Cmd
                    </kbd>
                    {' + '}
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      -
                    </kbd>
                  </td>
                  <td className="py-2">Zoom Out</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Ctrl/Cmd
                    </kbd>
                    {' + '}
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      +
                    </kbd>
                  </td>
                  <td className="py-2">Zoom In</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      Ctrl/Cmd
                    </kbd>
                    {' + '}
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                      0
                    </kbd>
                  </td>
                  <td className="py-2">Reset zoom to 100%</td>
                </tr>
              </tbody>
            </table>
          </DialogContent>
        </Dialog>

        {/* MCP setup command copy button */}
        {mcpEndpointUrl && (
          <Button
            variant="outline"
            size="icon"
            title={`Copy MCP setup command:\nclaude mcp add --transport http liz-whiteboard ${mcpEndpointUrl}`}
            onClick={() => {
              const setupCommand = `claude mcp add --transport http liz-whiteboard ${mcpEndpointUrl}`
              navigator.clipboard.writeText(setupCommand)
              toast.success(
                'MCP setup command copied — paste it in your terminal',
              )
            }}
          >
            <Link2 className="h-4 w-4" />
          </Button>
        )}

        {/* Version history (GH #107) — visible to VIEWER+; Save/Restore
            inside the panel are gated to EDITOR+. The panel itself is
            rendered by the caller (not here) to avoid a circular import:
            the panel's preview reuses ReactFlowWhiteboard, which is this
            Toolbar's own parent. */}
        {onOpenHistory && (
          <Button
            variant="outline"
            size="icon"
            title="Version history"
            aria-label="Version history"
            onClick={onOpenHistory}
          >
            <History className="h-4 w-4" />
          </Button>
        )}

        {/* Canvas comments (GH #110) — visible to VIEWER+; the panel itself
            is rendered by the caller (route) to avoid a circular import,
            same rationale as the history panel above. */}
        {onOpenComments && (
          <Button
            variant="outline"
            size="icon"
            title="Comments"
            aria-label="Comments"
            className="relative"
            onClick={onOpenComments}
          >
            <MessageCircle className="h-4 w-4" />
            {commentUnreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1.5 -top-1.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
              >
                {commentUnreadCount}
              </Badge>
            )}
          </Button>
        )}
      </div>

      {/* Zen Mode — hides all chrome, leaving only the canvas */}
      {onZenModeToggle && (
        <Button
          variant="outline"
          size="icon"
          onClick={onZenModeToggle}
          title="Zen Mode (z)"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      )}

      {/* Export diagram as image */}
      {onExport && (
        <>
          <span title={canExport ? 'Export as image' : 'Add a table to export'}>
            <Button
              variant="outline"
              size="icon"
              disabled={!canExport}
              onClick={() => setExportDialogOpen(true)}
              aria-label="Export as image"
            >
              <Download className="h-4 w-4" />
            </Button>
          </span>
          <ExportImageDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            onExport={async (opts) => {
              try {
                await onExport(opts)
              } catch {
                toast.error('Export failed')
              }
            }}
          />
        </>
      )}
    </div>
  )
}
