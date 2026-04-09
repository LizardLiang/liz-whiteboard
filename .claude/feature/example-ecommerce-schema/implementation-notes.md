# Implementation Notes: E-Commerce Demo Schema

**Feature**: example-ecommerce-schema
**Agent**: Ares (Implementation)
**Started**: 2026-03-30
**Status**: Complete

---

## Summary

Implemented the E-Commerce Demo Schema feature in 5 phases across 3 commits. The feature extends the Prisma Cardinality enum with 3 new values, wires them into the UI rendering pipeline, and creates a standalone seed script that populates a 14-table e-commerce schema demonstrating all 7 cardinality types, all 8 data types, and all 4 constraint flags.

---

## Files Created

| File                            | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `prisma/seed-ecommerce-demo.ts` | Standalone seed script for E-Commerce demo (Phases 3-5) |

## Files Modified

| File                                                  | Changes                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `schema.prisma` (root)                                | Added ZERO_TO_ONE, ZERO_TO_MANY, SELF_REFERENCING to Cardinality enum                   |
| `prisma/schema.prisma`                                | Added ZERO_TO_ONE, ZERO_TO_MANY, SELF_REFERENCING to Cardinality enum                   |
| `src/data/schema.ts`                                  | Extended cardinalitySchema Zod enum to 7 values                                         |
| `src/lib/react-flow/convert-to-edges.ts`              | Added cases for 3 new cardinalities in both marker switch statements + default fallback |
| `src/components/whiteboard/Toolbar.tsx`               | Extended CARDINALITIES array from 4 to 7 entries                                        |
| `src/components/whiteboard/RelationshipEdge.tsx`      | Added getCardinalityText() cases for new types                                          |
| `src/components/whiteboard/CardinalityMarkerDefs.tsx` | Registered 4 new marker IDs (zero-one-left, zero-many-left + highlights)                |
| `package.json`                                        | Added db:seed-demo script                                                               |

---

## Phase-by-Phase Notes

### Phase 1: Schema Extension

**Discovery**: There are two schema files in the project:

- `schema.prisma` (root directory) — this is the canonical schema used by the Prisma CLI
- `prisma/schema.prisma` — appears to be a documentation copy (may be a duplicate artifact from project history)

Both were updated to keep them in sync. The prisma CLI reads from the root `schema.prisma` based on CWD discovery.

**Database**: Used `bun run db:push` (not `prisma migrate dev`) because the database uses Prisma Accelerate (`prisma+postgres://` URL), and the existing project pattern is to use `db:push`. Attempting `prisma migrate dev` failed due to schema drift (the database was previously set up via `db:push`, not migrations).

**Prisma Client**: After `db:push`, ran `db:generate` to confirm the new enum values appear in `.prisma/client/index.d.ts`.

### Phase 2: UI Integration

All 4 UI files updated independently:

- `convert-to-edges.ts`: Added 3 new cases per switch statement plus `default` fallback
- `Toolbar.tsx`: Extended CARDINALITIES array, Zero or One label is "Zero or One (0..1)"
- `RelationshipEdge.tsx`: ZERO_TO_ONE → {0, 1}, ZERO_TO_MANY → {0, N}, SELF_REFERENCING → {1, N}
- `CardinalityMarkerDefs.tsx`: Reused existing `CardinalityZeroOrOneLeftMarker` and `CardinalityZeroOrManyLeftMarker` components with new IDs

### Phase 3: Seed Infrastructure

**Deviation from spec**: The tech-spec specified `"db:seed-demo": "dotenv -e .env.local -- ts-node prisma/seed-ecommerce-demo.ts"` but `ts-node` does not support ESM modules correctly in this project's `"type": "module"` package.json. Changed to `"db:seed-demo": "dotenv -e .env.local -- bun prisma/seed-ecommerce-demo.ts"` which works correctly since the project uses Bun as its runtime.

### Phases 4 & 5: Table Data and Relationships

**Deviation from spec (transaction)**: The tech-spec called for wrapping all seed operations in a single `prisma.$transaction`. However, Prisma Accelerate limits interactive transactions to 15 seconds max, and the full seed operation exceeds this. Changed to sequential operations without a transaction wrapper.

**Trade-off**: Without a transaction, a partial failure mid-seed would leave the database in a partially seeded state. The idempotency check (project name) would then fail on re-run since the project record was already created. Users would need to manually delete the partial data. This is documented as deferred technical debt below.

**Relationship #2 column choice**: The spec showed `customers.email` as the source column for `customers -> orders`. Changed to `customers.id` since `id` is the canonical PK for relationships, and `@@unique([sourceColumnId, targetColumnId])` only requires uniqueness of the column pair — not of the source column itself.

**Unused variable suppression**: Added `void variable` statements to suppress TypeScript `declared but never read` warnings for column reference variables that are stored for completeness but not directly used in relationship creation.

---

## Deviations from Tech Spec

| #   | Deviation                                                                      | Reason                                                           | Impact                                             |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Root `schema.prisma` is the canonical file (not `prisma/schema.prisma`)        | Prisma CLI reads from CWD; root file is authoritative            | Minor: both files updated                          |
| 2   | Used `bun` instead of `ts-node` in `db:seed-demo` script                       | `ts-node` doesn't handle ESM modules; bun is the project runtime | Low: same execution result                         |
| 3   | No `prisma.$transaction` wrapper in seed script                                | Accelerate 15-second limit on interactive transactions           | Medium: partial failure risk if seed fails mid-run |
| 4   | `customers.id` used as source for relationship #2 instead of `customers.email` | More canonical FK pattern; both satisfy the constraint           | Cosmetic                                           |

---

## Deferred Technical Debt

### DEBT-1: Seed script partial failure recovery

**Location**: `prisma/seed-ecommerce-demo.ts`
**Issue**: Without a transaction, a mid-execution failure leaves partial data in the database. The idempotency check only detects the project record; if it's created but tables/relationships fail, re-running the script would skip due to the project existing.
**Mitigation**: Users can delete the partial project via Prisma Studio or by running `prisma db seed` (existing seed) which deletes all data.
**Priority**: Low (development/demo tool only)

### DEBT-2: Self-referencing edge visual rendering

**Location**: React Flow canvas
**Issue**: The SELF_REFERENCING cardinality creates a relationship where `sourceTableId === targetTableId`. React Flow may not render this as a visible looping edge.
**Mitigation**: Database record is correct; visual rendering is a follow-up feature.
**Priority**: Low (noted in decomposition risk register)

---

## Test Results

| Suite                                                      | Tests  | Status   |
| ---------------------------------------------------------- | ------ | -------- |
| `src/lib/parser/diagram-parser.test.ts`                    | 18     | PASS     |
| `src/data/schema.test.ts`                                  | 16     | PASS     |
| `src/lib/react-flow/convert-to-edges.test.ts`              | 16     | PASS     |
| `src/components/whiteboard/Toolbar.test.tsx`               | 14     | PASS     |
| `src/components/whiteboard/RelationshipEdge.test.tsx`      | 7      | PASS     |
| `src/components/whiteboard/CardinalityMarkerDefs.test.tsx` | 9      | PASS     |
| **Total**                                                  | **80** | **PASS** |

No test failures.

---

## Seed Script Verification

Run results (first execution):

```
[seed-demo] Demo seeded successfully!
[seed-demo]   Project:       E-Commerce Demo (f7e2c119-2f07-4f78-87c2-23bc33f5ad8a)
[seed-demo]   Whiteboard:    E-Commerce Platform Schema (e0d0264e-8ca5-476c-91d3-7a7cfdb57c40)
[seed-demo]   Tables:        14
[seed-demo]   Columns:       ~85
[seed-demo]   Relationships: 18
```

Idempotency verified (second execution):

```
[seed-demo] E-Commerce Demo project already exists (id: f7e2c119-...). Skipping seed.
```

---

## Gap-Fill Summary (PRD Alignment Closure)

Hera identified 6 gaps after initial implementation. All gaps closed on 2026-03-30:

| Gap   | Item                                                       | Resolution                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-02 | Prisma migration file                                      | Created `prisma/migrations/20260330000000_add_cardinality_enum_values/migration.sql` manually. `prisma migrate dev` is not supported with Prisma Accelerate (`prisma+postgres://`). The SQL documents the equivalent `ALTER TYPE "Cardinality" ADD VALUE` DDL applied via `db:push`. |
| TS-2  | `src/data/schema.test.ts`                                  | Created with 16 tests: all 7 values accepted, unknown values rejected, new values work in `createRelationshipSchema`. Note: Zod v4 UUID format is strict (RFC 4122 variant bits required) — test fixtures use proper v4 UUIDs.                                                       |
| TS-8  | `src/lib/react-flow/convert-to-edges.test.ts`              | Created with 16 tests: all 7 marker start/end IDs verified, default fallback verified as non-undefined.                                                                                                                                                                              |
| TS-9  | `src/components/whiteboard/Toolbar.test.tsx`               | Created with 14 tests. Exported `CARDINALITIES` from `Toolbar.tsx` to make it testable.                                                                                                                                                                                              |
| TS-10 | `src/components/whiteboard/RelationshipEdge.test.tsx`      | Created with 7 tests. Exported `getCardinalityText` from `RelationshipEdge.tsx` to make it testable.                                                                                                                                                                                 |
| TS-11 | `src/components/whiteboard/CardinalityMarkerDefs.test.tsx` | Created with 9 tests. Used `innerHTML` fallback for SVG `<marker>` ID detection (jsdom CSS selector `#id` does not match SVG namespace `<marker>` elements reliably).                                                                                                                |

**Exports added** (minimal surface, no breaking changes):

- `CARDINALITIES` array in `Toolbar.tsx` — was `const`, now `export const`
- `getCardinalityText` function in `RelationshipEdge.tsx` — was `function`, now `export function`

## Commits

| Commit     | Message                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 032115a    | feat(example-ecommerce-schema): Phase 1 - extend Cardinality enum with ZERO_TO_ONE, ZERO_TO_MANY, SELF_REFERENCING |
| afdd40b    | feat(example-ecommerce-schema): Phase 2 - wire new cardinality values into UI rendering pipeline                   |
| 189f882    | feat(example-ecommerce-schema): Phases 3-5 - E-Commerce demo seed script                                           |
| (gap-fill) | feat(example-ecommerce-schema): close PRD alignment gaps - migration file + 5 unit test suites                     |
