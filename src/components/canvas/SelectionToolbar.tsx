// src/components/canvas/SelectionToolbar.tsx
// The controls for whatever is selected: paint (fill, stroke, weight) and
// paint ORDER (bring to front, send to back).
//
// A floating bar anchored above the selection, matching `ConnectorToolbar`'s
// placement rule and for the same reason: a board holds many shapes and the
// control has to say WHICH ones it is about. Anchoring it to the selection is
// the only placement that answers that without a label.
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
// AND NOT WHILE AN ELEMENT IS BEING EDITED. `render.ts`'s
// `drawSelectionOverlay` already withholds the resize grips for the duration
// of a text edit (`!selection.editing`); this bar follows the same rule, so
// every piece of selection chrome appears and disappears together. Beyond the
// consistency, a quick-created element is opened for typing while its own
// create is still in flight, and a live toolbar mounted across that id
// reconciliation was observed to cost the edit its text — see
// canvas-quick-create.spec.ts's "opens the new element for typing".

import { Ban, BringToFront, SendToBack } from 'lucide-react'
import type { Camera } from '@/lib/canvas-engine/camera'
import type {
  CanvasElement,
  CanvasElementStyle,
  Scene,
} from '@/lib/canvas-engine/scene'
import type { ZOrderCommand } from '@/lib/canvas-engine/z-order'
import { worldToScreen } from '@/lib/canvas-engine/camera'
import { boundsOfMany, isCanvasShapeKind } from '@/lib/canvas-engine/scene'
import { zOrderTargets } from '@/lib/canvas-engine/z-order'
import {
  CANVAS_STROKE_WIDTHS,
  CANVAS_SWATCHES,
  DEFAULT_STROKE_WIDTH,
  FILL_NONE,
} from '@/lib/canvas-style-palette'
import { Button } from '@/components/ui/button'

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
   * row's own none choice, which this union already expresses as
   * `{ target: 'stroke', value: null }`.
   */
  | { target: 'strokeWidth'; value: number }

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
  if (change.target === 'strokeWidth') {
    // Deliberately unconditional: choosing a weight on a shape whose stroke
    // is currently cleared turns the outline back ON at that weight, using
    // the colour the clear preserved. That is the second, equally natural way
    // back from "no stroke" — the first being to pick a colour — and blocking
    // it would leave the row looking inert on exactly the shapes a user is
    // most likely to be adjusting.
    return { ...style, strokeWidth: change.value }
  }
  if (change.value === null) return { ...style, strokeWidth: 0 }
  return {
    ...style,
    stroke: change.value,
    strokeWidth: style.strokeWidth > 0 ? style.strokeWidth : DEFAULT_STROKE_WIDTH,
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
 */
export function selectionToolbarTargets(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  readOnly: boolean,
  editingElementId: string | null = null,
): { arrange: Array<CanvasElement>; paint: Array<CanvasElement> } | null {
  if (readOnly || editingElementId !== null || selectedIds.size === 0) return null
  const arrange = zOrderTargets(scene, selectedIds)
  if (arrange.length === 0) return null
  return { arrange, paint: arrange.filter((e) => isCanvasShapeKind(e.kind)) }
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
}

export function SelectionToolbar({
  scene,
  selectedIds,
  camera,
  readOnly,
  editingElementId,
  onStyleChange,
  onArrange,
}: SelectionToolbarProps) {
  const sets = selectionToolbarTargets(scene, selectedIds, readOnly, editingElementId)
  const box = boundsOfMany(sets?.arrange ?? [])
  if (!sets || !box) return null
  const targets = sets.paint

  const anchor = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y })

  // `null` in either position means "the targets disagree", which renders as
  // no active swatch — see `shared`.
  const activeFill = shared(targets, (element) =>
    element.style.fill === FILL_NONE ? null : element.style.fill,
  )
  const fillCleared = shared(targets, (element) => element.style.fill === FILL_NONE)
  const strokeCleared = shared(targets, (element) => element.style.strokeWidth === 0)
  const activeStroke = shared(targets, (element) =>
    element.style.strokeWidth === 0 ? null : element.style.stroke,
  )
  // A cleared stroke has no weight to show — the stroke row's none button is
  // what is active then. A stored weight outside the offered set (an older
  // row) also shows nothing active rather than snapping to the nearest.
  const activeWidth = shared(targets, (element) =>
    element.style.strokeWidth === 0 ? null : element.style.strokeWidth,
  )

  const emit = (change: CanvasStyleChange) => {
    // Every target already in the requested state writes nothing. Without
    // this, a stray click on the active swatch pushes an undo entry that
    // reverses to itself, and the user's Ctrl+Z appears to do nothing several
    // times in a row — the same guard the routing picker states for itself.
    const changed = targets.filter(
      (element) =>
        !stylesEqual(element.style, applyStyleChange(element.style, change)),
    )
    if (changed.length === 0) return
    onStyleChange(changed, change)
  }

  return (
    <div
      className="absolute z-10 flex flex-col gap-1 rounded-md border bg-background/90 p-1.5 shadow-sm backdrop-blur-sm"
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
      <SwatchRow
        rowLabel="Fill"
        activeSwatchValue={activeFill}
        noneActive={fillCleared === true}
        readSwatch={(swatch) => swatch.fill}
        onPick={(value) => emit({ target: 'fill', value })}
      />
      <SwatchRow
        rowLabel="Stroke"
        activeSwatchValue={activeStroke}
        noneActive={strokeCleared === true}
        readSwatch={(swatch) => swatch.stroke}
        onPick={(value) => emit({ target: 'stroke', value })}
      />
      <WidthRow
        activeWidth={activeWidth}
        strokeColor={activeStroke}
        onPick={(value) => emit({ target: 'strokeWidth', value })}
      />
        </>
      )}
      <ArrangeRow onArrange={(command) => onArrange(sets.arrange, command)} />
    </div>
  )
}

/** Do two styles paint identically? Field-wise, because `CanvasElementStyle` is a flat value. */
function stylesEqual(a: CanvasElementStyle, b: CanvasElementStyle): boolean {
  return (
    a.fill === b.fill &&
    a.stroke === b.stroke &&
    a.strokeWidth === b.strokeWidth &&
    a.fontSize === b.fontSize &&
    a.color === b.color
  )
}

/**
 * Bring to front / send to back.
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
function ArrangeRow({ onArrange }: { onArrange: (command: ZOrderCommand) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Arrange">
      <span className="w-10 select-none pl-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Order
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-5 w-8"
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
        className="h-5 w-8"
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
 * The stroke-weight row: each button IS a line of the weight it sets.
 *
 * A sample rather than a number, for the same reason the swatches are colours
 * rather than names — the control should look like its result. The sample is
 * drawn in the selection's own stroke colour when they share one, so choosing
 * a weight previews the actual outline rather than a generic grey rule.
 */
function WidthRow({ activeWidth, strokeColor, onPick }: WidthRowProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Width">
      <span className="w-10 select-none pl-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Width
      </span>
      {CANVAS_STROKE_WIDTHS.map((width) => {
        const active = width === activeWidth
        return (
          <button
            key={width}
            type="button"
            className={`flex h-5 w-8 items-center justify-center rounded border transition-shadow ${
              active
                ? 'border-transparent ring-2 ring-ring ring-offset-1 ring-offset-background'
                : 'border-border/60'
            }`}
            // Matches the ER whiteboard's own picker (`Stroke width 2`), so
            // one vocabulary covers both boards for anyone reading either.
            aria-label={`Stroke width ${width}`}
            aria-pressed={active}
            title={`${width}px stroke`}
            onClick={() => onPick(width)}
          >
            <span
              className="block w-5 rounded-full"
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

function SwatchRow({
  rowLabel,
  activeSwatchValue,
  noneActive,
  readSwatch,
  onPick,
}: SwatchRowProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={rowLabel}>
      <span className="w-10 select-none pl-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {rowLabel}
      </span>
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
            className={`h-5 w-5 rounded-full border-2 transition-shadow ${
              active ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : ''
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
        className="h-5 w-5"
        aria-label={`${rowLabel} none`}
        aria-pressed={noneActive}
        title={`No ${rowLabel.toLowerCase()}`}
        onClick={() => onPick(null)}
      >
        <Ban className="h-3 w-3" />
      </Button>
    </div>
  )
}
