// src/components/canvas/SelectionToolbar.tsx
// The controls for whatever is selected: paint (fill, stroke, weight, corner)
// and paint ORDER (bring to front, send to back).
//
// A floating bar anchored above the selection, matching `ConnectorToolbar`'s
// placement rule and for the same reason: a board holds many shapes and the
// control has to say WHICH ones it is about. Anchoring it to the selection is
// the only placement that answers that without a label.
//
// ONE ROW OF POPOVERS, not a stack of open rows. Every setting used to be
// laid out at once, so the bar grew a row per setting — four of them, plus
// order and copy — and a bar that tall sitting over a small shape covers the
// very thing the user is restyling. Each SETTING now collapses to a single
// trigger that PREVIEWS its current value and opens its options on click,
// which keeps the bar one row high however many settings the selection
// supports.
//
// The two ACTION groups stay as plain buttons. Order and duplicate are
// commands, not values — there is nothing to preview on a closed trigger and
// nothing to keep open across picks, so a popover would buy no height back
// and cost a click on every use.
//
// Every coordinate comes from `camera.ts`'s `worldToScreen` and the world rect
// comes from `scene.ts`'s `boundsOfMany`. Nothing here computes a transform of
// its own — the structural answer to W1/W3, both of which were a second,
// divergent transform written at a call site. Reading the LIVE camera on every
// render is also what makes the bar re-anchor on pan and zoom for free.
//
// TWO TARGET SETS, deliberately, which is why this is a selection toolbar and
// no longer a shape-style one. Paint applies to SHAPES only: a text element
// has a style but `drawElement` paints no fill or outline for one, and a
// connector's stroke belongs with its routing picker, which owns that
// selection already. Paint ORDER applies to every paintable element, text
// included — text overlaps shapes and needs to be able to come forward.
// Offering controls that visibly do nothing is worse than offering none, and
// so is withholding ones that would work.
//
// ALIGNMENT rides on the SECOND set, not the first, and that is the whole
// reason the sets earn their keep. `drawElement` draws a text block for every
// kind that has one, so alignment reaches a pure `text` element even though
// no paint setting does — which is exactly the case a single shapes-only set
// would have got wrong. Connectors are excluded from both sets and so from
// this too; they carry no text.
//
// AND NOT WHILE AN ELEMENT IS BEING EDITED. `render.ts`'s
// `drawSelectionOverlay` already withholds the resize grips for the duration
// of a text edit (`!selection.editing`); this bar follows the same rule, so
// every piece of selection chrome appears and disappears together. Beyond the
// consistency, a quick-created element is opened for typing while its own
// create is still in flight, and a live toolbar mounted across that id
// reconciliation was observed to cost the edit its text — see
// canvas-quick-create.spec.ts's "opens the new element for typing".

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Ban,
  BringToFront,
  CopyPlus,
  Group as GroupIcon,
  SendToBack,
  Ungroup as UngroupIcon,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { Camera } from '@/lib/canvas-engine/camera'
import type {
  CanvasElement,
  CanvasElementStyle,
  CanvasTextAlign,
  CanvasVerticalAlign,
  Scene,
} from '@/lib/canvas-engine/scene'
import type { ZOrderCommand } from '@/lib/canvas-engine/z-order'
import { worldToScreen } from '@/lib/canvas-engine/camera'
import { boundsOfMany, isCanvasShapeKind } from '@/lib/canvas-engine/scene'
import { zOrderTargets } from '@/lib/canvas-engine/z-order'
import {
  CANVAS_CORNER_RADII,
  CANVAS_STROKE_WIDTHS,
  CANVAS_SWATCHES,
  DEFAULT_STROKE_WIDTH,
  FILL_NONE,
  swatchForFill,
  swatchForStroke,
} from '@/lib/canvas-style-palette'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * How far ABOVE the selection's bounding box the bar sits, in screen pixels.
 *
 * Above rather than over: the bar is describing the paint of the shapes
 * underneath it, and a bar covering them would hide the only feedback the
 * user has that a swatch did anything.
 */
export const STYLE_TOOLBAR_OFFSET = 12

/**
 * One requested change, named by which half of the paint it touches.
 *
 * `value: null` is the "no paint" choice. It is one idea to the user and two
 * mechanisms in the data — see `FILL_NONE`'s note in the palette module —
 * which is exactly why the intent travels as a union and the translation
 * happens in `applyStyleChange` rather than at each button.
 */
export type CanvasStyleChange =
  | { target: 'fill'; value: string | null }
  | { target: 'stroke'; value: string | null }
  /**
   * A stroke WEIGHT, in world units. Never null: "no stroke" is the stroke
   * setting's own none choice, which this union already expresses as
   * `{ target: 'stroke', value: null }`.
   */
  | { target: 'strokeWidth'; value: number }
  /**
   * A corner RADIUS, in world units. Rectangles only — the setting is not
   * offered when the selection holds none, and the change is emitted against
   * the rectangles in it rather than everything selected, so a marquee over a
   * rectangle and an ellipse rounds the one that has corners and writes
   * nothing to the one that does not.
   *
   * Never null: zero rounding is a radius of 0, the same field at one end of
   * its range, not a second mechanism the way "no stroke" is.
   */
  | { target: 'cornerRadius'; value: number }
  /**
   * Text alignment. Applies to every element that can HOLD text — all four
   * shapes and `text` — which is a wider set than the paint changes above,
   * and the reason this bar computes two target sets rather than one.
   *
   * Never null in either axis: each is a closed set of three positions, and
   * there is no "unaligned" state to express.
   */
  | { target: 'textAlign'; value: CanvasTextAlign }
  | { target: 'verticalAlign'; value: CanvasVerticalAlign }

/**
 * The style an element should end up with after a change.
 *
 * Pure and exported because the stroke rules are not obvious and deserve to
 * be tested directly rather than through a rendered toolbar:
 *
 *  - Clearing a stroke sets `strokeWidth: 0` and LEAVES the colour alone, so
 *    re-enabling the stroke brings the shape's own colour back rather than
 *    resetting it to a default the user never chose.
 *  - Setting a stroke colour on a shape whose stroke is currently cleared has
 *    to restore a width too, or the click would appear to do nothing at all.
 *    An existing non-zero width is preserved, so re-colouring a 4px outline
 *    does not silently thin it to 2px.
 */
export function applyStyleChange(
  style: CanvasElementStyle,
  change: CanvasStyleChange,
): CanvasElementStyle {
  if (change.target === 'fill') {
    return { ...style, fill: change.value ?? FILL_NONE }
  }
  if (change.target === 'cornerRadius') {
    return { ...style, cornerRadius: change.value }
  }
  // Straight writes, both of them — no clear/restore pairing to honour the way
  // stroke has, because neither axis has an "off".
  if (change.target === 'textAlign') {
    return { ...style, textAlign: change.value }
  }
  if (change.target === 'verticalAlign') {
    return { ...style, verticalAlign: change.value }
  }
  if (change.target === 'strokeWidth') {
    // Deliberately unconditional: choosing a weight on a shape whose stroke
    // is currently cleared turns the outline back ON at that weight, using
    // the colour the clear preserved. That is the second, equally natural way
    // back from "no stroke" — the first being to pick a colour — and blocking
    // it would leave the setting looking inert on exactly the shapes a user
    // is most likely to be adjusting.
    return { ...style, strokeWidth: change.value }
  }
  if (change.value === null) return { ...style, strokeWidth: 0 }
  return {
    ...style,
    stroke: change.value,
    strokeWidth:
      style.strokeWidth > 0 ? style.strokeWidth : DEFAULT_STROKE_WIDTH,
  }
}

/**
 * The shapes this toolbar would restyle, in scene order.
 *
 * Exported and pure for the same reason `connectorToolbarTarget` is: the
 * conditions under which the bar appears are a rule, not an incidental
 * arrangement of JSX.
 *
 * A MIXED selection (shapes plus a connector, say) yields just the shapes
 * rather than nothing. Refusing to work on a mixed selection would mean a
 * marquee that happened to catch one connector silently disabled the whole
 * toolbar, with no visible reason.
 */
export function shapeStyleTargets(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  readOnly: boolean,
  /** The element currently open for typing, if any — see the file header. */
  editingElementId: string | null = null,
): Array<CanvasElement> {
  if (readOnly || editingElementId !== null || selectedIds.size === 0) return []
  return scene.elements.filter(
    (element) => selectedIds.has(element.id) && isCanvasShapeKind(element.kind),
  )
}

/**
 * The value every target shares, or null when they disagree.
 *
 * A mixed selection showing NO active swatch is the honest answer and the
 * conventional one — showing the first element's colour would claim the
 * others match it.
 */
function shared<T>(
  targets: ReadonlyArray<CanvasElement>,
  read: (element: CanvasElement) => T,
): T | null {
  if (targets.length === 0) return null
  const first = read(targets[0])
  return targets.every((element) => read(element) === first) ? first : null
}

/**
 * Everything the toolbar is about, or null when there is nothing to show.
 *
 * One place decides both the bar's visibility and its two target sets, so a
 * future control cannot accidentally appear for a selection the bar itself is
 * hidden for.
 *
 * `arrange` and `paint` deliberately read from TWO DIFFERENT sets, not one
 * filtered into the other. `arrange` is `zOrderTargets`'s own result, which
 * (canvas-element-grouping tactical plan, Wave 3) EXPANDS a selected group
 * to its whole subtree — correct for Bring to Front/Send to Back, which
 * must move a group's members with it (FR-015). `paint` reads the RAW
 * selection instead: bulk Fill/Stroke/Width/Corner styling across a
 * group's members is explicitly out of scope (PRD "Out of Scope" — this
 * toolbar disables those controls for a group selection rather than
 * reaching into it), so `paint` must NOT inherit `arrange`'s expansion —
 * doing so would silently restyle a group's descendants the instant one
 * was selected, which is exactly the out-of-scope behaviour FR-031 exists
 * to prevent.
 */
export function selectionToolbarTargets(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  readOnly: boolean,
  editingElementId: string | null = null,
): { arrange: Array<CanvasElement>; paint: Array<CanvasElement> } | null {
  if (readOnly || editingElementId !== null || selectedIds.size === 0)
    return null
  const arrange = zOrderTargets(scene, selectedIds)
  if (arrange.length === 0) return null
  const selected = scene.elements.filter((element) =>
    selectedIds.has(element.id),
  )
  return {
    arrange,
    paint: selected.filter((e) => isCanvasShapeKind(e.kind)),
  }
}

/**
 * Whether the CURRENT (unexpanded) selection may be bound into a new group
 * (FR-030/A1) — two or more elements, no upper bound and no kind
 * restriction, since a selection that already contains a group nests it
 * with no special case (FR-009).
 */
export function canGroupSelection(selectedIds: ReadonlySet<string>): boolean {
  return selectedIds.size >= 2
}

/**
 * Whether the CURRENT selection resolves to exactly one group element —
 * the only state Ungroup is meaningful in (FR-008).
 */
export function canUngroupSelection(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): boolean {
  if (selectedIds.size !== 1) return false
  const [id] = selectedIds
  return scene.byId.get(id)?.group !== undefined
}

export interface SelectionToolbarProps {
  scene: Scene
  selectedIds: ReadonlySet<string>
  camera: Camera
  readOnly: boolean
  /** The element currently open for typing, if any. The bar hides while one is. */
  editingElementId: string | null
  /**
   * Called with the shapes to restyle and the change to apply. Never called
   * when the change would leave every target exactly as it is.
   */
  onStyleChange: (
    targets: Array<CanvasElement>,
    change: CanvasStyleChange,
  ) => void
  /**
   * Called with the elements to re-order and which end to move them to. Never
   * called when they are already at that end — `planZOrder` decides that, and
   * this component asks it before emitting.
   */
  onArrange: (targets: Array<CanvasElement>, command: ZOrderCommand) => void
  /**
   * Copy the current selection in place. Takes no targets, unlike the two
   * above: duplicate reads the LIVE selection from the input hook, which is
   * the same source the Ctrl+D shortcut uses. Handing it a target list here
   * would be a second answer to "what is selected" that could disagree with
   * the first.
   */
  onDuplicate: () => void
  /**
   * Bind the current selection into a new group. No-argument, mirroring
   * `onDuplicate`'s own shape and reasoning: reads the LIVE selection from
   * the input hook, the same source Ctrl+G uses.
   */
  onGroup: () => void
  /** Dissolve the current selection's single group. Mirrors `onGroup`. */
  onUngroup: () => void
}

export function SelectionToolbar({
  scene,
  selectedIds,
  camera,
  readOnly,
  editingElementId,
  onStyleChange,
  onArrange,
  onDuplicate,
  onGroup,
  onUngroup,
}: SelectionToolbarProps) {
  const sets = selectionToolbarTargets(
    scene,
    selectedIds,
    readOnly,
    editingElementId,
  )
  const box = boundsOfMany(sets?.arrange ?? [])
  if (!sets || !box) return null
  const targets = sets.paint
  const canGroup = canGroupSelection(selectedIds)
  const canUngroup = canUngroupSelection(scene, selectedIds)

  const anchor = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y })

  // `null` in either position means "the targets disagree", which renders as
  // no active swatch — see `shared`.
  const activeFill = shared(targets, (element) =>
    element.style.fill === FILL_NONE ? null : element.style.fill,
  )
  const fillCleared = shared(
    targets,
    (element) => element.style.fill === FILL_NONE,
  )
  const strokeCleared = shared(
    targets,
    (element) => element.style.strokeWidth === 0,
  )
  const activeStroke = shared(targets, (element) =>
    element.style.strokeWidth === 0 ? null : element.style.stroke,
  )
  // A cleared stroke has no weight to show — the stroke setting's none button
  // is what is active then. A stored weight outside the offered set (an older
  // row) also shows nothing active rather than snapping to the nearest.
  const activeWidth = shared(targets, (element) =>
    element.style.strokeWidth === 0 ? null : element.style.strokeWidth,
  )

  // Rectangles are the only kind with corners to round. Taken from `targets`
  // rather than from `selectedIds` so the setting obeys the same "may this be
  // restyled at all" rules — read-only, mid-edit — as every other one.
  const roundable = targets.filter((element) => element.kind === 'rectangle')
  const activeRadius = shared(
    roundable,
    (element) => element.style.cornerRadius,
  )

  // Alignment applies to whatever can HOLD text, which is a WIDER set than
  // paint: `drawElement` draws a text block for every kind that has one, so a
  // pure `text` element takes alignment even though it takes no fill, stroke
  // or corner. That set is exactly `arrange` — every paintable element, text
  // included, connectors excluded — so it is reused rather than recomputed.
  const alignable = sets.arrange
  const activeTextAlign = shared(
    alignable,
    (element) => element.style.textAlign,
  )
  const activeVerticalAlign = shared(
    alignable,
    (element) => element.style.verticalAlign,
  )

  const emit = (change: CanvasStyleChange, list = targets) => {
    // Every target already in the requested state writes nothing. Without
    // this, a stray click on the active swatch pushes an undo entry that
    // reverses to itself, and the user's Ctrl+Z appears to do nothing several
    // times in a row — the same guard the routing picker states for itself.
    const changed = list.filter(
      (element) =>
        !stylesEqual(element.style, applyStyleChange(element.style, change)),
    )
    if (changed.length === 0) return
    onStyleChange(changed, change)
  }

  return (
    <div
      className="absolute z-10 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
      style={{
        left: anchor.x,
        top: anchor.y - STYLE_TOOLBAR_OFFSET,
        // Centred on the selection and sitting entirely above it. A transform
        // rather than a measured width, which would need a layout pass and
        // would be wrong on the first frame of every selection.
        transform: 'translate(-50%, -100%)',
      }}
      role="toolbar"
      aria-label="Selection"
    >
      {targets.length > 0 && (
        <>
          <SettingPopover
            label="Fill"
            summary={colorSummary(
              activeFill,
              fillCleared === true,
              swatchForFill,
            )}
            preview={
              <ColorPreview
                row="Fill"
                value={activeFill}
                cleared={fillCleared === true}
              />
            }
          >
            <SwatchRow
              rowLabel="Fill"
              activeSwatchValue={activeFill}
              noneActive={fillCleared === true}
              readSwatch={(swatch) => swatch.fill}
              onPick={(value) => emit({ target: 'fill', value })}
            />
          </SettingPopover>
          <SettingPopover
            label="Stroke"
            summary={colorSummary(
              activeStroke,
              strokeCleared === true,
              swatchForStroke,
            )}
            preview={
              <ColorPreview
                row="Stroke"
                value={activeStroke}
                cleared={strokeCleared === true}
              />
            }
          >
            <SwatchRow
              rowLabel="Stroke"
              activeSwatchValue={activeStroke}
              noneActive={strokeCleared === true}
              readSwatch={(swatch) => swatch.stroke}
              onPick={(value) => emit({ target: 'stroke', value })}
            />
          </SettingPopover>
          <SettingPopover
            label="Width"
            summary={widthSummary(activeWidth, strokeCleared === true)}
            preview={
              <WidthPreview width={activeWidth} strokeColor={activeStroke} />
            }
          >
            <WidthRow
              activeWidth={activeWidth}
              strokeColor={activeStroke}
              onPick={(value) => emit({ target: 'strokeWidth', value })}
            />
          </SettingPopover>
          {roundable.length > 0 && (
            <SettingPopover
              label="Corner"
              summary={radiusSummary(activeRadius)}
              preview={<RadiusPreview radius={activeRadius} />}
            >
              <RadiusRow
                activeRadius={activeRadius}
                onPick={(value) =>
                  emit({ target: 'cornerRadius', value }, roundable)
                }
              />
            </SettingPopover>
          )}
          <Divider />
        </>
      )}
      {alignable.length > 0 && (
        <>
          <SettingPopover
            label="Align"
            summary={alignSummary(activeTextAlign, activeVerticalAlign)}
            preview={
              <AlignPreview
                textAlign={activeTextAlign}
                verticalAlign={activeVerticalAlign}
              />
            }
          >
            <AlignRow
              rowLabel="Horizontal"
              options={HORIZONTAL_ALIGNS}
              active={activeTextAlign}
              onPick={(value) =>
                emit({ target: 'textAlign', value }, alignable)
              }
            />
            <AlignRow
              rowLabel="Vertical"
              options={VERTICAL_ALIGNS}
              active={activeVerticalAlign}
              onPick={(value) =>
                emit({ target: 'verticalAlign', value }, alignable)
              }
            />
          </SettingPopover>
          <Divider />
        </>
      )}
      <ArrangeRow onArrange={(command) => onArrange(sets.arrange, command)} />
      <Divider />
      <ActionsRow
        onDuplicate={onDuplicate}
        onGroup={onGroup}
        onUngroup={onUngroup}
        canGroup={canGroup}
        canUngroup={canUngroup}
      />
    </div>
  )
}

/**
 * The hairline between the settings, the order buttons and the actions.
 *
 * `aria-hidden` rather than `role="separator"`: it carries no meaning a screen
 * reader needs, because each group it divides already announces itself through
 * its own label.
 */
function Divider() {
  return (
    <div aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
  )
}

interface SettingPopoverProps {
  /** The setting's name — the trigger's accessible name and its visible caption. */
  label: string
  /** The current value in words, for the trigger's tooltip. */
  summary: string
  /** A miniature of the current value, so the CLOSED trigger still answers "what is it now?". */
  preview: ReactNode
  children: ReactNode
}

/**
 * One setting: a trigger that previews its value, and the options behind it.
 *
 * UNCONTROLLED, so the popover stays open across picks. Choosing paint is a
 * comparison — three weights tried in a row, two greens held against each
 * other — and a popover that dismissed itself on the first click would make
 * every pick after the first cost two clicks. Radix closes it on the next
 * pointer-down outside, which on this board is the click that moves on to
 * something else.
 *
 * It opens on `side="top"`, above a bar that is itself above the selection, so
 * the options never cover the shapes they are restyling. Radix flips it below
 * on its own when the selection sits near the top of the viewport.
 *
 * The content is PORTALLED (`PopoverContent` wraps `Popover.Portal`), which
 * keeps it clear of the canvas ELEMENT and its pointer handlers — but not of
 * the board CONTAINER, and that distinction cost a round of red e2e runs. A
 * React portal bubbles events through the React TREE, not the DOM tree, so a
 * keydown inside the popover still reached `CanvasBoard`'s container
 * `onKeyDown` (the same trap `handleBoardKeyDown` documents for the text
 * proxy) and Escape closed the popover AND cleared the selection under it.
 * `stopPropagation` below is what ends that: Radix listens for Escape on the
 * document in the CAPTURE phase, so it still closes, while nothing from
 * inside the popover reaches the board's tool shortcuts.
 */
function SettingPopover({
  label,
  summary,
  preview,
  children,
}: SettingPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-6 gap-1 px-1.5"
          aria-label={label}
          title={`${label}: ${summary}`}
        >
          {preview}
          <span className="select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={6}
        className="w-auto p-2"
        // See the note above: the React tree, not the DOM tree, decides where
        // a portalled event goes next, and next is the board container.
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="mb-1.5 select-none px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {children}
      </PopoverContent>
    </Popover>
  )
}

/**
 * The current colour as a dot, or the reason there is not one.
 *
 * Three states, and they are genuinely different answers: a colour, "cleared"
 * (the `Ban` glyph the none button uses, so the trigger and the option it is
 * reflecting look alike), and "the targets disagree" — a dashed empty ring,
 * which claims no colour rather than picking one of the selection's.
 */
function ColorPreview({
  row,
  value,
  cleared,
}: {
  row: 'Fill' | 'Stroke'
  value: string | null
  cleared: boolean
}) {
  if (cleared) return <Ban className="size-3.5 text-muted-foreground" />
  if (value === null) {
    return (
      <span className="block size-3.5 rounded-full border-2 border-dashed border-muted-foreground/60" />
    )
  }
  // A fill is 10% alpha, so a flat fill dot is a near-white smudge. The hue's
  // solid stroke as the border is what makes it legible — the same trick
  // `swatchStyle` plays on the fill swatches themselves.
  const border =
    row === 'Fill' ? (swatchForFill(value)?.stroke ?? value) : value
  return (
    <span
      className="block size-3.5 rounded-full border-2"
      style={{ backgroundColor: value, borderColor: border }}
    />
  )
}

/** The current weight, drawn at that weight in the selection's own stroke colour. */
function WidthPreview({
  width,
  strokeColor,
}: {
  width: number | null
  strokeColor: string | null
}) {
  if (width === null) {
    return (
      <span className="block h-0 w-4 border-t-2 border-dashed border-muted-foreground/60" />
    )
  }
  return (
    <span
      className="block w-4 rounded-full"
      style={{
        height: `${width}px`,
        backgroundColor: strokeColor ?? 'currentColor',
      }}
    />
  )
}

/** The current rounding, drawn on a 14px square — see `RadiusRow` on the scaling. */
function RadiusPreview({ radius }: { radius: number | null }) {
  if (radius === null) {
    return (
      <span className="block size-3.5 border border-dashed border-muted-foreground/60" />
    )
  }
  return (
    <span
      className="block size-3.5 border border-current"
      style={{ borderRadius: `${radius / 2}px` }}
    />
  )
}

/**
 * The current colour in words, for a trigger's tooltip.
 *
 * "Custom" covers a stored value this palette never wrote — an older row, a
 * hand-edited one. It is the same honesty the swatches themselves show by
 * marking none of them active rather than snapping to the nearest hue.
 */
function colorSummary(
  value: string | null,
  cleared: boolean,
  lookup: (value: string) => { label: string } | null,
): string {
  if (cleared) return 'None'
  if (value === null) return 'Mixed'
  return lookup(value)?.label ?? 'Custom'
}

/** The current weight in words. A cleared stroke has no weight, and says so. */
function widthSummary(width: number | null, cleared: boolean): string {
  if (cleared) return 'None'
  if (width === null) return 'Mixed'
  return `${width}px`
}

/** The current rounding in words. Zero is "Square", not "0px" — it is a shape, not a measurement. */
function radiusSummary(radius: number | null): string {
  if (radius === null) return 'Mixed'
  return radius === 0 ? 'Square' : `${radius}px`
}

/**
 * Duplicate, Group, Ungroup.
 *
 * Duplicate is the one member of the copy family with a button. Paste has no
 * selection to hang a control off — it works with nothing selected, which is
 * exactly when this bar is hidden — and copy and cut are the half of the
 * idiom every user already reaches for on the keyboard. Duplicate is the one
 * people do not know is there, so it is the one that gets shown. Always
 * enabled, for the same reason the arrange buttons are: the bar only renders
 * for a non-empty editable selection, so there is always something to copy.
 *
 * Group and Ungroup are DISABLED rather than hidden when they do not apply
 * (FR-030's own wording: "the Group control is disabled"), matching the
 * literal PRD acceptance criteria rather than the hide-when-inapplicable
 * pattern the settings popovers above use — those hide because there is
 * nothing to preview for zero targets; these stay visible so a user can see
 * the shortcut exists at all.
 */
function ActionsRow({
  onDuplicate,
  onGroup,
  onUngroup,
  canGroup,
  canUngroup,
}: {
  onDuplicate: () => void
  onGroup: () => void
  onUngroup: () => void
  canGroup: boolean
  canUngroup: boolean
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Actions">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-7"
        aria-label="Duplicate"
        title="Duplicate (Ctrl+D)"
        // Wrapped rather than passed straight through: React would otherwise
        // hand the click event to a callback declared as taking nothing, and
        // the next person to give `onDuplicate` a parameter would find a
        // MouseEvent already sitting in it.
        onClick={() => onDuplicate()}
      >
        <CopyPlus className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-7"
        aria-label="Group"
        title="Group (Ctrl+G)"
        disabled={!canGroup}
        onClick={() => onGroup()}
      >
        <GroupIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-7"
        aria-label="Ungroup"
        title="Ungroup (Ctrl+Shift+G)"
        disabled={!canUngroup}
        onClick={() => onUngroup()}
      >
        <UngroupIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

/**
 * Do two styles paint identically?
 *
 * Compared over the KEYS rather than field by field, and that is the whole
 * point: this listed its five fields by hand until `cornerRadius` was added
 * to `CanvasElementStyle`, at which point it reported a rounded shape and a
 * square one as identical — so `emit` filtered every radius click away as
 * "already in that state" and the new control did nothing at all, silently.
 * `CanvasElementStyle` is a flat value with no nested members, so it has no
 * reason to be compared by an enumeration that can fall behind it.
 *
 * Both sides are spread so a key missing from one still gets compared, rather
 * than an absent field passing by never being looked at.
 */
function stylesEqual(a: CanvasElementStyle, b: CanvasElementStyle): boolean {
  const keys = Object.keys({ ...a, ...b }) as Array<keyof CanvasElementStyle>
  return keys.every((key) => a[key] === b[key])
}

/**
 * Bring to front / send to back.
 *
 * NOT behind a popover, unlike the four settings: these are commands, not
 * values. There is no current state to preview on a closed trigger and
 * nothing to keep open across picks, so collapsing them would buy no height
 * back and cost a click on every use.
 *
 * Two buttons, not four: one-step forward and backward need a well-defined
 * neighbour to swap with, and a canvas element's `zIndex` is NOT unique — the
 * column defaults to 0 and raw seed scripts write it, so several rows commonly
 * tie and "the element directly above" is decided by an id tie-break rather
 * than by a value there is room to swap. Making one-step reliable means
 * renumbering the whole stack on every click, which rewrites every row on the
 * board for a one-shape edit. That is a real design decision, not an
 * oversight, and it is deliberately not being taken here.
 *
 * Always enabled. Whether a command would change anything depends on the
 * selection's position in the stack, and `planZOrder` already answers that and
 * returns an empty plan — a disabled-looking button that is merely a no-op
 * this frame reads as broken.
 */
function ArrangeRow({
  onArrange,
}: {
  onArrange: (command: ZOrderCommand) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Arrange">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-7"
        aria-label="Bring to front"
        title="Bring to front"
        onClick={() => onArrange('front')}
      >
        <BringToFront className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-7"
        aria-label="Send to back"
        title="Send to back"
        onClick={() => onArrange('back')}
      >
        <SendToBack className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

interface WidthRowProps {
  /** The weight every target shares, or null when they disagree or the stroke is cleared. */
  activeWidth: number | null
  /** The shared stroke colour, so each sample is drawn in the colour it would produce. */
  strokeColor: string | null
  onPick: (value: number) => void
}

/**
 * The stroke-weight options: each button IS a line of the weight it sets.
 *
 * A sample rather than a number, for the same reason the swatches are colours
 * rather than names — the control should look like its result. The sample is
 * drawn in the selection's own stroke colour when they share one, so choosing
 * a weight previews the actual outline rather than a generic grey rule.
 */
function WidthRow({ activeWidth, strokeColor, onPick }: WidthRowProps) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Width">
      {CANVAS_STROKE_WIDTHS.map((width) => {
        const active = width === activeWidth
        return (
          <button
            key={width}
            type="button"
            className={`flex h-7 w-12 items-center justify-center rounded border transition-shadow ${
              active
                ? 'border-transparent ring-2 ring-ring ring-offset-1 ring-offset-background'
                : 'border-border/60'
            }`}
            aria-label={`Stroke width ${width}`}
            aria-pressed={active}
            title={`${width}px stroke`}
            onClick={() => onPick(width)}
          >
            <span
              className="block w-7 rounded-full"
              style={{
                height: `${width}px`,
                backgroundColor: strokeColor ?? 'currentColor',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

/**
 * One alignment option: the value written, its icon, and its name.
 *
 * The two axes are separate tables rather than one nine-cell grid, because
 * they are two independent fields — a user changing only the vertical
 * position should not have to restate the horizontal one, which is exactly
 * what a combined nine-position control forces.
 */
interface AlignOption<T> {
  value: T
  label: string
  Icon: ComponentType<{ className?: string }>
}

const HORIZONTAL_ALIGNS: ReadonlyArray<AlignOption<CanvasTextAlign>> = [
  { value: 'left', label: 'Left', Icon: AlignLeft },
  { value: 'center', label: 'Center', Icon: AlignCenter },
  { value: 'right', label: 'Right', Icon: AlignRight },
]

const VERTICAL_ALIGNS: ReadonlyArray<AlignOption<CanvasVerticalAlign>> = [
  { value: 'top', label: 'Top', Icon: AlignVerticalJustifyStart },
  { value: 'middle', label: 'Middle', Icon: AlignVerticalJustifyCenter },
  { value: 'bottom', label: 'Bottom', Icon: AlignVerticalJustifyEnd },
]

interface AlignRowProps<T> {
  /** Which axis this row is — its group label, and half of each button's name. */
  rowLabel: 'Horizontal' | 'Vertical'
  options: ReadonlyArray<AlignOption<T>>
  /** The position every target shares, or null when they disagree. */
  active: T | null
  onPick: (value: T) => void
}

/**
 * One axis of text alignment, as three icon buttons.
 *
 * Icons rather than words, matching every other setting in this popover: the
 * control looks like its result. Each button's accessible name carries the
 * AXIS as well as the position ("Align left", "Align top") because the two
 * rows sit one above the other and "Left"/"Top" alone would not say which
 * control a screen reader had landed on.
 *
 * A row with nothing active is the honest rendering of a mixed selection —
 * the same convention `shared` documents for the swatches.
 */
function AlignRow<T extends string>({
  rowLabel,
  options,
  active,
  onPick,
}: AlignRowProps<T>) {
  return (
    <div
      className="flex items-center gap-1.5 [&+&]:mt-1.5"
      role="group"
      aria-label={rowLabel}
    >
      {options.map(({ value, label, Icon }) => {
        const isActive = value === active
        return (
          <button
            key={value}
            type="button"
            className={`flex h-7 w-12 items-center justify-center rounded border transition-shadow ${
              isActive
                ? 'border-transparent ring-2 ring-ring ring-offset-1 ring-offset-background'
                : 'border-border/60'
            }`}
            aria-label={`Align ${label.toLowerCase()}`}
            aria-pressed={isActive}
            title={`Align ${label.toLowerCase()}`}
            onClick={() => onPick(value)}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * The current alignment as a single icon: the horizontal position, which is
 * the axis a glance at a shape actually reads.
 *
 * A dashed placeholder when the targets disagree, matching `ColorPreview`'s
 * third state — a closed trigger must not claim one element's alignment for
 * the whole selection.
 */
function AlignPreview({
  textAlign,
  verticalAlign,
}: {
  textAlign: CanvasTextAlign | null
  verticalAlign: CanvasVerticalAlign | null
}) {
  if (textAlign === null && verticalAlign === null) {
    return (
      <span className="block size-3.5 rounded-sm border border-dashed border-muted-foreground/60" />
    )
  }
  const Icon =
    HORIZONTAL_ALIGNS.find((option) => option.value === textAlign)?.Icon ??
    AlignLeft
  return <Icon className="size-3.5" />
}

/** The current alignment in words, for the trigger's tooltip. */
function alignSummary(
  textAlign: CanvasTextAlign | null,
  verticalAlign: CanvasVerticalAlign | null,
): string {
  const horizontal =
    HORIZONTAL_ALIGNS.find((option) => option.value === textAlign)?.label ??
    'Mixed'
  const vertical =
    VERTICAL_ALIGNS.find((option) => option.value === verticalAlign)?.label ??
    'Mixed'
  return `${horizontal} · ${vertical}`
}

interface RadiusRowProps {
  /** The shared radius across the rectangles, or null when they disagree. */
  activeRadius: number | null
  onPick: (value: number) => void
}

/**
 * Corner rounding for rectangles.
 *
 * Each button previews its own radius rather than naming a number, the same
 * choice the width options make: the swatch IS the answer to "what will this
 * look like", and a user picking a corner shape is matching a picture, not a
 * measurement. The preview is a fixed-size square scaled down, so the three
 * read as a progression even though the stored values are world units that
 * mean different things on a small shape and a large one.
 */
function RadiusRow({ activeRadius, onPick }: RadiusRowProps) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Corner">
      {CANVAS_CORNER_RADII.map((radius) => {
        const active = radius === activeRadius
        return (
          <button
            key={radius}
            type="button"
            className={`flex h-7 w-12 items-center justify-center rounded border transition-shadow ${
              active
                ? 'border-transparent ring-2 ring-ring ring-offset-1 ring-offset-background'
                : 'border-border/60'
            }`}
            aria-label={`Corner radius ${radius}`}
            aria-pressed={active}
            title={radius === 0 ? 'Square corners' : `${radius}px corners`}
            onClick={() => onPick(radius)}
          >
            <span
              className="block h-4 w-4 border border-current"
              style={{ borderRadius: `${radius / 2}px` }}
            />
          </button>
        )
      })}
    </div>
  )
}

interface SwatchRowProps {
  rowLabel: string
  /** The shared value across the targets, or null when they disagree or it is cleared. */
  activeSwatchValue: string | null
  /** Whether every target has this half of the paint turned off. */
  noneActive: boolean
  readSwatch: (swatch: (typeof CANVAS_SWATCHES)[number]) => string
  onPick: (value: string | null) => void
}

/**
 * How one swatch is drawn: a miniature of what picking it produces.
 *
 * The FILL row would otherwise be unusable. A fill is 10% alpha, so eight
 * fill swatches rendered as flat circles are eight near-identical near-white
 * dots — red, orange and amber are indistinguishable at that opacity. Giving
 * the fill swatch the hue's SOLID colour as its border makes it legible while
 * still showing the translucency it will actually paint, which is exactly
 * what the shape on the board looks like.
 *
 * The stroke row needs none of that: it is already a solid colour.
 */
function swatchStyle(
  row: string,
  swatch: (typeof CANVAS_SWATCHES)[number],
  value: string,
): { backgroundColor: string; borderColor: string } {
  return row === 'Fill'
    ? { backgroundColor: value, borderColor: swatch.stroke }
    : { backgroundColor: value, borderColor: value }
}

/**
 * The eight swatches plus the none button, five to a line.
 *
 * A grid rather than the single strip this used to be: inside a popover there
 * is no bar width to stay within, and two short lines are quicker to scan
 * than one nine-wide row. The buttons are bigger here for the same reason —
 * nothing is competing for the space any more.
 */
function SwatchRow({
  rowLabel,
  activeSwatchValue,
  noneActive,
  readSwatch,
  onPick,
}: SwatchRowProps) {
  return (
    <div
      className="grid grid-cols-5 gap-1.5"
      role="group"
      aria-label={rowLabel}
    >
      {CANVAS_SWATCHES.map((swatch) => {
        const value = readSwatch(swatch)
        const active = value === activeSwatchValue
        return (
          <button
            key={swatch.id}
            type="button"
            // A plain button, not the shadcn `Button`: this control IS its
            // colour, so any variant background would sit on top of the one
            // thing it needs to show. The ring carries the selected state
            // instead.
            className={`h-6 w-6 rounded-full border-2 transition-shadow ${
              active
                ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
                : ''
            }`}
            style={swatchStyle(rowLabel, swatch, value)}
            aria-label={`${rowLabel} ${swatch.label}`}
            aria-pressed={active}
            title={`${rowLabel} ${swatch.label}`}
            onClick={() => onPick(value)}
          />
        )
      })}
      <Button
        type="button"
        size="icon"
        variant={noneActive ? 'default' : 'ghost'}
        className="h-6 w-6 border-2 border-transparent"
        aria-label={`${rowLabel} none`}
        aria-pressed={noneActive}
        title={`No ${rowLabel.toLowerCase()}`}
        onClick={() => onPick(null)}
      >
        <Ban className="size-3.5" />
      </Button>
    </div>
  )
}
