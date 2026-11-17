// src/lib/react-flow/cardinality-marker.ts
// One definition of the cardinality marker geometry. RelationshipEdge draws
// from it and the router/edge pass size each end's minimum stub from it, so
// the drawn marker and the straight segment that must hold it cannot drift.

// A line and its marker start ON the table border (not at the connect dot), so
// the crow's foot prongs and the bars end 1 px outside it (negative inset) so
// the table border does not clip them.
export const TABLE_INSET = -1
/**
 * Crow's foot length outward from the table border: the prong tips sit 1 px
 * outside the border and converge CROW_LENGTH out, so the foot is
 * 10 px long.
 */
export const CROW_LENGTH = 11
/** Crow's foot half-spread (perpendicular distance of outer prongs). */
export const CROW_SPREAD = 6
/** Curvature of outer prongs (quadratic bezier bow). */
export const CROW_CURVE = 3
/** Multiplicity bar inset toward the table from the border. */
export const MULT_BAR_INSET = -1
/** Bar half-height (perpendicular extent of a bar symbol). */
export const BAR_HALF = 6
/** Open circle radius (for the zero/optional symbol). */
export const CIRCLE_R = 4
/** Empty space between the foot tip and the optionality symbol after a crow's foot. */
export const OPT_GAP_MANY = 6
/** Distance from the table border to the optionality bar centre after a "one" bar. */
export const OPT_DIST_ONE = 7
/** Half the stroke of a bar: how far a bar reaches past its centre. */
export const BAR_REACH = 1
/** Air between the outermost marker edge and the first bend of the line. */
export const MARKER_AIR = 3

/** Distance from the table border to the optionality symbol centre. */
export function optSymbolDistance(
  isMany: boolean,
  isOptional: boolean,
): number {
  if (!isMany) return OPT_DIST_ONE
  return CROW_LENGTH + OPT_GAP_MANY + (isOptional ? CIRCLE_R : 0)
}

/** Distance from the table border to the outermost edge of the marker. */
export function markerExtent(isMany: boolean, isOptional: boolean): number {
  return (
    optSymbolDistance(isMany, isOptional) + (isOptional ? CIRCLE_R : BAR_REACH)
  )
}

/** Shortest first/last route segment at an end: the marker plus its air. */
export function markerMinStub(isMany: boolean, isOptional: boolean): number {
  return markerExtent(isMany, isOptional) + MARKER_AIR
}

export interface CardinalityFlags {
  srcMany: boolean
  srcOpt: boolean
  tgtMany: boolean
  tgtOpt: boolean
}

const CARDINALITY_FLAGS: Record<string, CardinalityFlags> = {
  ONE_TO_ONE: { srcMany: false, srcOpt: false, tgtMany: false, tgtOpt: false },
  ONE_TO_MANY: { srcMany: false, srcOpt: false, tgtMany: true, tgtOpt: false },
  MANY_TO_ONE: { srcMany: true, srcOpt: false, tgtMany: false, tgtOpt: false },
  MANY_TO_MANY: { srcMany: true, srcOpt: false, tgtMany: true, tgtOpt: false },
  ZERO_TO_ONE: { srcMany: false, srcOpt: false, tgtMany: false, tgtOpt: true },
  ZERO_TO_MANY: { srcMany: false, srcOpt: false, tgtMany: true, tgtOpt: true },
  SELF_REFERENCING: {
    srcMany: false,
    srcOpt: false,
    tgtMany: true,
    tgtOpt: true,
  },
  MANY_TO_ZERO_OR_ONE: {
    srcMany: true,
    srcOpt: false,
    tgtMany: false,
    tgtOpt: true,
  },
  MANY_TO_ZERO_OR_MANY: {
    srcMany: true,
    srcOpt: false,
    tgtMany: true,
    tgtOpt: true,
  },
  ZERO_OR_ONE_TO_ONE: {
    srcMany: false,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: false,
  },
  ZERO_OR_ONE_TO_MANY: {
    srcMany: false,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: false,
  },
  ZERO_OR_ONE_TO_ZERO_OR_ONE: {
    srcMany: false,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: true,
  },
  ZERO_OR_ONE_TO_ZERO_OR_MANY: {
    srcMany: false,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: true,
  },
  ZERO_OR_MANY_TO_ONE: {
    srcMany: true,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: false,
  },
  ZERO_OR_MANY_TO_MANY: {
    srcMany: true,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: false,
  },
  ZERO_OR_MANY_TO_ZERO_OR_ONE: {
    srcMany: true,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: true,
  },
  ZERO_OR_MANY_TO_ZERO_OR_MANY: {
    srcMany: true,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: true,
  },
}

const NO_FLAGS: CardinalityFlags = {
  srcMany: false,
  srcOpt: false,
  tgtMany: false,
  tgtOpt: false,
}

export function cardinalityFlags(
  cardinality: string | undefined,
): CardinalityFlags {
  return CARDINALITY_FLAGS[cardinality ?? ''] ?? NO_FLAGS
}

/** Minimum stub per end for a relationship's cardinality. */
export function endMinStubs(cardinality: string | undefined): {
  source: number
  target: number
} {
  const f = cardinalityFlags(cardinality)
  return {
    source: markerMinStub(f.srcMany, f.srcOpt),
    target: markerMinStub(f.tgtMany, f.tgtOpt),
  }
}
