// src/components/whiteboard/Toolbar.tsx
// Floating bottom dock for whiteboard actions: primary tools stay on the dock,
// secondary tools live in the More menu, zoom lives in the zoom menu.

import { useRef, useState } from 'react'
import {
  ExternalLink,
  LayoutGrid,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  SquareDashed,
  Table2,
  Waypoints,
  ZoomIn,
  ZoomOut,
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
import type { ToolMode } from '@/lib/react-flow/tool-mode'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { McpConnectPanel } from '@/components/mcp/McpConnectPanel'

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
/**
 * Drag payload type for the Reference toolbar item (LizMeter #83). A custom
 * MIME keeps the canvas's onDrop from reacting to arbitrary dragged content.
 */
export const REFERENCE_DRAG_MIME = 'application/x-liz-table-reference'

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
  /**
   * Place a cross-file reference node (LizMeter #83). Called with a drop point
   * in FLOW coordinates when the item is dragged onto the canvas, or with no
   * point when it is simply clicked — the caller then places it at the
   * viewport centre. When omitted, no Reference item is rendered.
   */
  onAddReference?: (dropPoint?: { x: number; y: number }) => void
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
  /**
   * Whether the canvas is locked: no element can be moved, resized, created,
   * connected, deleted or selected. Pan, zoom, search and comments stay live.
   */
  canvasLocked?: boolean
  /** Toggle the canvas lock. When omitted, no lock item is rendered. */
  onToggleCanvasLock?: () => void
  /** Armed canvas tool; drives the pressed state of the Area and Comment buttons. */
  activeTool?: ToolMode
  /** Arm or disarm a canvas tool. When omitted, no Area or Comment button is rendered. */
  onSelectTool?: (tool: ToolMode) => void
  /** Whether the viewer may place comment pins. */
  canComment?: boolean
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
 * Floating dock for whiteboard actions
 *
 * Features:
 * - Add Table and Add Relationship buttons with dialogs
 * - Reference, Area, Comment, Auto Layout, Search and Comments buttons
 * - Zoom menu and a More menu holding the secondary tools
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
  onAddReference,
  tableCount,
  onAutoLayoutClick,
  isAutoLayoutRunning = false,
  zoomControls,
  currentZoom = 1,
  canvasLocked = false,
  onToggleCanvasLock,
  activeTool = 'select',
  onSelectTool,
  canComment = false,
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

  // Help dialog and MCP dialog state. Both open from More menu items, so they
  // are controlled rather than wrapped around a trigger inside the menu.
  const moreToolsRef = useRef<HTMLButtonElement>(null)
  // A dialog opened from a More menu item has no trigger of its own, so focus
  // would fall to <body> on close; send it back to the menu button.
  const returnFocusToMoreTools = (event: Event) => {
    event.preventDefault()
    moreToolsRef.current?.focus()
  }
  const [helpOpen, setHelpOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)

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

  const zoomPercent = Math.round(currentZoom * 100)
  // A locked canvas accepts no new tables, relationships, references, areas
  // or imports, so every create affordance follows `canWrite`.
  const canWrite = canEdit && !canvasLocked
  const writeBlockedTitle = canEdit
    ? 'Unlock the canvas to make changes.'
    : 'You have view-only access to this whiteboard.'
  const showAreaTool = canEdit && onSelectTool !== undefined
  const showCommentTool = canComment && onSelectTool !== undefined

  const divider = (
    <div className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
  )

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      data-testid="whiteboard-dock"
      className={`absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur-sm ${className}`}
    >
      {/* Add Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="default"
            size="sm"
            disabled={!canWrite}
            title={canWrite ? undefined : writeBlockedTitle}
          >
            <Table2 className="h-4 w-4" />
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
            size="sm"
            disabled={tables.length < 2 || !canWrite}
            title={canWrite ? undefined : writeBlockedTitle}
          >
            <Waypoints className="h-4 w-4" />
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

      {/* Reference another file's table (LizMeter #83). Draggable so it can
          be dropped at an exact spot, clickable so a trackpad or touch user
          can still place one. The drag payload is read by the canvas's
          onDrop, which converts the screen point to flow coordinates. */}
      {onAddReference && (
        <Button
          variant="ghost"
          size="icon"
          disabled={!canWrite}
          draggable={canWrite}
          data-testid="add-reference-tool"
          aria-label="Reference"
          onDragStart={(event) => {
            event.dataTransfer.setData(
              REFERENCE_DRAG_MIME,
              'external-table-reference',
            )
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onAddReference()}
          title={
            canWrite
              ? 'Reference: drag onto the canvas, or click to place at the centre'
              : writeBlockedTitle
          }
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}

      {/* Area and Comment are tool modes: the pressed state shows which one
          is armed. */}
      {showAreaTool && (
        <Button
          variant={activeTool === 'area' ? 'default' : 'ghost'}
          size="icon"
          disabled={canvasLocked}
          onClick={() =>
            onSelectTool(activeTool === 'area' ? 'select' : 'area')
          }
          title={
            canvasLocked
              ? writeBlockedTitle
              : activeTool === 'area'
                ? 'Drag on the canvas to draw the area'
                : 'Draw a subject area'
          }
          aria-label="Add area"
          aria-pressed={activeTool === 'area'}
        >
          <SquareDashed className="h-4 w-4" />
        </Button>
      )}
      {showCommentTool && (
        <Button
          variant={activeTool === 'comment' ? 'default' : 'ghost'}
          size="icon"
          onClick={() =>
            onSelectTool(activeTool === 'comment' ? 'select' : 'comment')
          }
          title={
            activeTool === 'comment'
              ? 'Click the canvas to place a comment'
              : 'Add a comment pin'
          }
          aria-label="Add comment"
          aria-pressed={activeTool === 'comment'}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
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
          variant="ghost"
          size="icon"
          aria-label="Auto Layout"
          aria-busy={isAutoLayoutRunning}
          disabled={tableCount < 2 || isAutoLayoutRunning}
          onClick={() => void onAutoLayoutClick?.()}
        >
          {isAutoLayoutRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LayoutGrid className="h-4 w-4" />
          )}
        </Button>
      </span>

      {(onOpenSearch || onOpenComments) && divider}

      {onOpenSearch && (
        <Button
          variant="ghost"
          size="icon"
          title="Search tables and columns (Ctrl/Cmd+K)"
          onClick={onOpenSearch}
        >
          <Search className="h-4 w-4" />
        </Button>
      )}

      {/* Canvas comments (GH #110) — visible to VIEWER+; the panel itself
          is rendered by the caller (route) to avoid a circular import,
          same rationale as the history panel in the More menu. */}
      {onOpenComments && (
        <Button
          variant="ghost"
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
              data-testid="comments-unresolved-badge"
              title={`${commentUnreadCount} unresolved comment thread${commentUnreadCount === 1 ? '' : 's'}`}
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
            >
              {commentUnreadCount}
            </Badge>
          )}
        </Button>
      )}

      {zoomControls && (
        <>
          {divider}
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomControls.zoomOut}
            disabled={currentZoom <= 0.1}
            title="Zoom Out (Ctrl/Cmd + -)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-14 tabular-nums"
                title="Zoom options"
                data-testid="zoom-menu-trigger"
              >
                {zoomPercent}%
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-52">
              <DropdownMenuItem onSelect={zoomControls.zoomIn}>
                Zoom in
                <DropdownMenuShortcut>Ctrl/Cmd +</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.zoomOut}>
                Zoom out
                <DropdownMenuShortcut>Ctrl/Cmd -</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.fitToScreen}>
                Fit to screen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.resetZoom}>
                Reset to 100%
                <DropdownMenuShortcut>Ctrl/Cmd 0</DropdownMenuShortcut>
              </DropdownMenuItem>
              {onToggleCanvasLock && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onToggleCanvasLock}>
                    {canvasLocked ? 'Unlock canvas' : 'Lock canvas'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={zoomControls.zoomIn}
            disabled={currentZoom >= 5}
            title="Zoom In (Ctrl/Cmd + +)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </>
      )}

      {divider}

      {/* Secondary tools. Each item opens a controlled dialog or a panel
          owned by this component or the caller. The menu is
          non-modal so a dialog opened from an item does not inherit the
          menu's pointer-events lock. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={moreToolsRef}
            variant="ghost"
            size="icon"
            title="More tools"
            aria-label="More tools"
            data-testid="more-tools-trigger"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-56">
          {onImportSql && (
            <DropdownMenuItem
              disabled={!canWrite}
              title={canWrite ? undefined : writeBlockedTitle}
              onSelect={() => setImportSqlOpen(true)}
            >
              Import SQL
            </DropdownMenuItem>
          )}
          {onShowModeChange && (
            <>
              {onImportSql && <DropdownMenuSeparator />}
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={showMode}
                onValueChange={(value) => onShowModeChange(value as ShowMode)}
              >
                <DropdownMenuRadioItem
                  value="TABLE_NAME"
                  title="Show table names only"
                >
                  Compact
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="KEY_ONLY"
                  title="Show table names and primary/foreign keys"
                >
                  Keys
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="ALL_FIELDS"
                  title="Show all columns"
                >
                  All
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
          {(onOpenHistory || mcpEndpointUrl || onExport) && (
            <DropdownMenuSeparator />
          )}
          {/* Version history (GH #107) — visible to VIEWER+; Save/Restore
                inside the panel are gated to EDITOR+. The panel itself is
                rendered by the caller (not here) to avoid a circular
                import: the panel's preview reuses ReactFlowWhiteboard,
                which is this Toolbar's own parent. */}
          {onOpenHistory && (
            <DropdownMenuItem onSelect={onOpenHistory}>
              Version history
            </DropdownMenuItem>
          )}
          {/* MCP client connect popover — one McpConnectPanel mount, the
                other is on /settings/connections. Public-share exclusion
                comes from the caller passing no endpoint. */}
          {mcpEndpointUrl && (
            <DropdownMenuItem
              onSelect={() => {
                setMcpOpen(true)
              }}
            >
              Connect an MCP client
            </DropdownMenuItem>
          )}
          {onExport && (
            <DropdownMenuItem
              disabled={!canExport}
              title={canExport ? undefined : 'Add a table to export'}
              onSelect={() => setExportDialogOpen(true)}
            >
              Export as image
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {onZenModeToggle && (
            <DropdownMenuItem onSelect={onZenModeToggle}>
              Zen mode
              <DropdownMenuShortcut>z</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
            Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {mcpEndpointUrl && (
        <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
          <DialogContent
            className="sm:max-w-[460px]"
            onCloseAutoFocus={returnFocusToMoreTools}
          >
            <DialogHeader>
              <DialogTitle>Connect an MCP client</DialogTitle>
            </DialogHeader>
            <McpConnectPanel endpointUrl={mcpEndpointUrl} />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent
          className="sm:max-w-[420px]"
          onCloseAutoFocus={returnFocusToMoreTools}
        >
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

      {onImportSql && (
        <ImportSqlDialog
          open={importSqlOpen}
          onOpenChange={setImportSqlOpen}
          onImport={onImportSql}
          onCloseAutoFocus={returnFocusToMoreTools}
        />
      )}

      {onExport && (
        <ExportImageDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          onCloseAutoFocus={returnFocusToMoreTools}
          onExport={async (opts) => {
            try {
              await onExport(opts)
            } catch {
              toast.error('Export failed')
            }
          }}
        />
      )}
    </div>
  )
}
