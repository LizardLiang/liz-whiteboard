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
import { ExportSchemaDialog } from './ExportSchemaDialog'
import { ImportSqlDialog } from './ImportSqlDialog'
import type { ExportImageDialogOptions } from './ExportImageDialog'
import type { SchemaExportOptions } from '@/lib/export/schema-export'
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
import { useT } from '@/lib/i18n/use-t'

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
  /** Callback when the user confirms the Export schema dialog (tables,
   * columns and relationships as Excel / JSON / XML). When omitted, no
   * Export schema item is rendered. Disabled with `canExport`, like the
   * image export. Rejection is caught here and shown as an error toast. */
  onExportSchema?: (options: SchemaExportOptions) => void | Promise<void>
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
  onExportSchema,
  onImportSql,
  viewerRole,
  className = '',
}: ToolbarProps) {
  const t = useT()
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
  const [exportSchemaOpen, setExportSchemaOpen] = useState(false)

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
      alert(t('whiteboard.toolbar.tableNameRequired'))
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
      alert(t('whiteboard.toolbar.relationshipFieldsRequired'))
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
    tables.find((tb) => tb.id === sourceTableId)?.columns ?? []

  // Get columns for selected target table
  const targetColumns =
    tables.find((tb) => tb.id === targetTableId)?.columns ?? []

  const zoomPercent = Math.round(currentZoom * 100)
  // A locked canvas accepts no new tables, relationships, references, areas
  // or imports, so every create affordance follows `canWrite`.
  const canWrite = canEdit && !canvasLocked
  const writeBlockedTitle = canEdit
    ? t('whiteboard.toolbar.unlockToEdit')
    : t('whiteboard.toolbar.viewOnly')
  const showAreaTool = canEdit && onSelectTool !== undefined
  const showCommentTool = canComment && onSelectTool !== undefined

  const divider = (
    <div className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
  )

  return (
    <div
      role="toolbar"
      aria-label={t('whiteboard.toolbar.ariaLabel')}
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
            {t('whiteboard.toolbar.addTable')}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('whiteboard.toolbar.createTable')}</DialogTitle>
            <DialogDescription>
              {t('whiteboard.toolbar.createTableDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="table-name">
                {t('whiteboard.toolbar.tableName')}
              </Label>
              <Input
                id="table-name"
                placeholder={t('whiteboard.toolbar.tableNamePlaceholder')}
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
              <Label htmlFor="table-description">
                {t('whiteboard.toolbar.description')}
              </Label>
              <Textarea
                id="table-description"
                placeholder={t('whiteboard.toolbar.descriptionPlaceholder')}
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
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleCreateTable}>
              {t('whiteboard.toolbar.createTable')}
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
            {t('whiteboard.toolbar.addRelationship')}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {t('whiteboard.toolbar.createRelationship')}
            </DialogTitle>
            <DialogDescription>
              {t('whiteboard.toolbar.createRelationshipDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Source Table Selection */}
            <div className="grid gap-2">
              <Label htmlFor="source-table">
                {t('whiteboard.toolbar.sourceTable')}
              </Label>
              <Select value={sourceTableId} onValueChange={setSourceTableId}>
                <SelectTrigger id="source-table">
                  <SelectValue
                    placeholder={t('whiteboard.toolbar.selectSourceTable')}
                  />
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
              <Label htmlFor="source-column">
                {t('whiteboard.toolbar.sourceColumn')}
              </Label>
              <Select
                value={sourceColumnId}
                onValueChange={setSourceColumnId}
                disabled={!sourceTableId || sourceColumns.length === 0}
              >
                <SelectTrigger id="source-column">
                  <SelectValue
                    placeholder={t('whiteboard.toolbar.selectSourceColumn')}
                  />
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
              <Label htmlFor="target-table">
                {t('whiteboard.toolbar.targetTable')}
              </Label>
              <Select value={targetTableId} onValueChange={setTargetTableId}>
                <SelectTrigger id="target-table">
                  <SelectValue
                    placeholder={t('whiteboard.toolbar.selectTargetTable')}
                  />
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
              <Label htmlFor="target-column">
                {t('whiteboard.toolbar.targetColumn')}
              </Label>
              <Select
                value={targetColumnId}
                onValueChange={setTargetColumnId}
                disabled={!targetTableId || targetColumns.length === 0}
              >
                <SelectTrigger id="target-column">
                  <SelectValue
                    placeholder={t('whiteboard.toolbar.selectTargetColumn')}
                  />
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
              <Label htmlFor="cardinality">
                {t('whiteboard.toolbar.cardinality')}
              </Label>
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
                      {t(`whiteboard.cardinality.${option.value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Relationship Label */}
            <div className="grid gap-2">
              <Label htmlFor="rel-label">
                {t('whiteboard.toolbar.relationshipLabel')}
              </Label>
              <Input
                id="rel-label"
                placeholder={t(
                  'whiteboard.toolbar.relationshipLabelPlaceholder',
                )}
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
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleCreateRelationship}>
              {t('whiteboard.toolbar.createRelationship')}
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
          aria-label={t('whiteboard.toolbar.reference')}
          onDragStart={(event) => {
            event.dataTransfer.setData(
              REFERENCE_DRAG_MIME,
              'external-table-reference',
            )
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onAddReference()}
          title={
            canWrite ? t('whiteboard.toolbar.referenceHint') : writeBlockedTitle
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
                ? t('whiteboard.toolbar.areaDrawing')
                : t('whiteboard.toolbar.areaIdle')
          }
          aria-label={t('whiteboard.toolbar.addArea')}
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
              ? t('whiteboard.toolbar.commentPlacing')
              : t('whiteboard.toolbar.commentIdle')
          }
          aria-label={t('whiteboard.toolbar.addComment')}
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
            ? t('whiteboard.toolbar.autoLayoutNeedTables')
            : tableCount > 50
              ? t('whiteboard.toolbar.autoLayoutNoCancel')
              : t('whiteboard.toolbar.autoLayoutHint')
        }
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('whiteboard.toolbar.autoLayout')}
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
          title={t('whiteboard.toolbar.searchHint')}
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
          title={t('whiteboard.toolbar.comments')}
          aria-label={t('whiteboard.toolbar.comments')}
          className="relative"
          onClick={onOpenComments}
        >
          <MessageCircle className="h-4 w-4" />
          {commentUnreadCount > 0 && (
            <Badge
              variant="destructive"
              data-testid="comments-unresolved-badge"
              title={t(
                commentUnreadCount === 1
                  ? 'whiteboard.toolbar.unresolvedOne'
                  : 'whiteboard.toolbar.unresolvedOther',
                { count: commentUnreadCount },
              )}
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
            title={t('whiteboard.toolbar.zoomOutHint')}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-14 tabular-nums"
                title={t('whiteboard.toolbar.zoomOptions')}
                data-testid="zoom-menu-trigger"
              >
                {zoomPercent}%
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-52">
              <DropdownMenuItem onSelect={zoomControls.zoomIn}>
                {t('whiteboard.toolbar.zoomIn')}
                <DropdownMenuShortcut>Ctrl/Cmd +</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.zoomOut}>
                {t('whiteboard.toolbar.zoomOut')}
                <DropdownMenuShortcut>Ctrl/Cmd -</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.fitToScreen}>
                {t('whiteboard.toolbar.fitToScreen')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={zoomControls.resetZoom}>
                {t('whiteboard.toolbar.resetZoom')}
                <DropdownMenuShortcut>Ctrl/Cmd 0</DropdownMenuShortcut>
              </DropdownMenuItem>
              {onToggleCanvasLock && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onToggleCanvasLock}>
                    {canvasLocked
                      ? t('whiteboard.toolbar.unlockCanvas')
                      : t('whiteboard.toolbar.lockCanvas')}
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
            title={t('whiteboard.toolbar.zoomInHint')}
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
            title={t('whiteboard.toolbar.moreTools')}
            aria-label={t('whiteboard.toolbar.moreTools')}
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
              {t('whiteboard.toolbar.importSql')}
            </DropdownMenuItem>
          )}
          {onShowModeChange && (
            <>
              {onImportSql && <DropdownMenuSeparator />}
              <DropdownMenuLabel>
                {t('whiteboard.toolbar.showColumns')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={showMode}
                onValueChange={(value) => onShowModeChange(value as ShowMode)}
              >
                <DropdownMenuRadioItem
                  value="TABLE_NAME"
                  title={t('whiteboard.toolbar.showCompactHint')}
                >
                  {t('whiteboard.toolbar.showCompact')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="KEY_ONLY"
                  title={t('whiteboard.toolbar.showKeysHint')}
                >
                  {t('whiteboard.toolbar.showKeys')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="ALL_FIELDS"
                  title={t('whiteboard.toolbar.showAllHint')}
                >
                  {t('whiteboard.toolbar.showAll')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
          {(onOpenHistory || mcpEndpointUrl || onExport || onExportSchema) && (
            <DropdownMenuSeparator />
          )}
          {/* Version history (GH #107) — visible to VIEWER+; Save/Restore
                inside the panel are gated to EDITOR+. The panel itself is
                rendered by the caller (not here) to avoid a circular
                import: the panel's preview reuses ReactFlowWhiteboard,
                which is this Toolbar's own parent. */}
          {onOpenHistory && (
            <DropdownMenuItem onSelect={onOpenHistory}>
              {t('whiteboard.toolbar.versionHistory')}
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
              {t('whiteboard.toolbar.connectMcp')}
            </DropdownMenuItem>
          )}
          {onExport && (
            <DropdownMenuItem
              disabled={!canExport}
              title={
                canExport ? undefined : t('whiteboard.toolbar.addTableToExport')
              }
              onSelect={() => setExportDialogOpen(true)}
            >
              {t('whiteboard.toolbar.exportImage')}
            </DropdownMenuItem>
          )}
          {onExportSchema && (
            <DropdownMenuItem
              disabled={!canExport}
              title={
                canExport ? undefined : t('whiteboard.toolbar.addTableToExport')
              }
              onSelect={() => setExportSchemaOpen(true)}
            >
              {t('whiteboard.toolbar.exportSchema')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {onZenModeToggle && (
            <DropdownMenuItem onSelect={onZenModeToggle}>
              {t('whiteboard.toolbar.zenMode')}
              <DropdownMenuShortcut>z</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
            {t('whiteboard.toolbar.keyboardShortcuts')}
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
              <DialogTitle>{t('whiteboard.toolbar.connectMcp')}</DialogTitle>
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
            <DialogTitle>{t('whiteboard.toolbar.shortcutsTitle')}</DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium text-muted-foreground">
                  {t('whiteboard.toolbar.shortcutKey')}
                </th>
                <th className="py-2 text-left font-medium text-muted-foreground">
                  {t('whiteboard.toolbar.shortcutAction')}
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
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutSearch')}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4">
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                    z
                  </kbd>
                </td>
                <td className="py-2">{t('whiteboard.toolbar.shortcutZen')}</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                    f
                  </kbd>
                </td>
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutFocus')}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4">
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">
                    m
                  </kbd>
                </td>
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutMinimap')}
                </td>
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
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutDelete')}
                </td>
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
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutZoomOut')}
                </td>
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
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutZoomIn')}
                </td>
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
                <td className="py-2">
                  {t('whiteboard.toolbar.shortcutZoomReset')}
                </td>
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
              toast.error(t('whiteboard.toolbar.exportFailed'))
            }
          }}
        />
      )}

      {onExportSchema && (
        <ExportSchemaDialog
          open={exportSchemaOpen}
          onOpenChange={setExportSchemaOpen}
          onCloseAutoFocus={returnFocusToMoreTools}
          onExport={async (options) => {
            try {
              await onExportSchema(options)
            } catch (error) {
              toast.error(t('whiteboard.toolbar.exportFailed'))
              throw error
            }
          }}
        />
      )}
    </div>
  )
}
