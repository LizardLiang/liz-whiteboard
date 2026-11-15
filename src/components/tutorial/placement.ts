export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export type Side = 'below' | 'above' | 'right' | 'left' | 'center'

export interface Placement {
  left: number
  top: number
  side: Side
}

export const CARD_GUTTER = 16
export const CARD_GAP = 12
export const CUTOUT_PADDING = 6

export function padRect(rect: Rect, pad: number): Rect {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/**
 * Place the card next to the cutout: below if it fits, else above, else right,
 * else left, else centred. Always clamped inside the viewport by the gutter.
 */
export function placeCard(
  cutout: Rect | null,
  card: Size,
  viewport: Size,
): Placement {
  const maxLeft = viewport.width - card.width - CARD_GUTTER
  const maxTop = viewport.height - card.height - CARD_GUTTER
  const centred: Placement = {
    left: clamp((viewport.width - card.width) / 2, CARD_GUTTER, maxLeft),
    top: clamp((viewport.height - card.height) / 2, CARD_GUTTER, maxTop),
    side: 'center',
  }
  if (!cutout) return centred

  const cx = cutout.left + cutout.width / 2 - card.width / 2
  const cy = cutout.top + cutout.height / 2 - card.height / 2
  const bottom = cutout.top + cutout.height
  const right = cutout.left + cutout.width

  if (bottom + CARD_GAP + card.height <= viewport.height - CARD_GUTTER) {
    return {
      left: clamp(cx, CARD_GUTTER, maxLeft),
      top: bottom + CARD_GAP,
      side: 'below',
    }
  }
  if (cutout.top - CARD_GAP - card.height >= CARD_GUTTER) {
    return {
      left: clamp(cx, CARD_GUTTER, maxLeft),
      top: cutout.top - CARD_GAP - card.height,
      side: 'above',
    }
  }
  if (right + CARD_GAP + card.width <= viewport.width - CARD_GUTTER) {
    return {
      left: right + CARD_GAP,
      top: clamp(cy, CARD_GUTTER, maxTop),
      side: 'right',
    }
  }
  if (cutout.left - CARD_GAP - card.width >= CARD_GUTTER) {
    return {
      left: cutout.left - CARD_GAP - card.width,
      top: clamp(cy, CARD_GUTTER, maxTop),
      side: 'left',
    }
  }
  return centred
}
