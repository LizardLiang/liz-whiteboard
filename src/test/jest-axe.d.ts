// src/test/jest-axe.d.ts
// Minimal ambient typing for `jest-axe`, scoped to the single export
// src/test/setup.ts actually uses (toHaveNoViolations, passed to Vitest's
// expect.extend). No `@types/jest-axe` package exists to install, and
// adding one wasn't part of this pass's approved scope — this local
// declaration is the same pattern as e2e/bun-sqlite.d.ts.
declare module 'jest-axe' {
  interface AxeMatcherResult {
    pass: boolean
    message: () => string
  }
  export const toHaveNoViolations: Record<
    string,
    (received: unknown, ...expected: Array<unknown>) => AxeMatcherResult
  >
}
