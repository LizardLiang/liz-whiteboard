// e2e/compare-constants.ts
// Ids shared by the version-compare seed (e2e/seed-compare.ts, run under Bun)
// and its spec (Node). No imports: both runtimes load this file.

export const CMP_IDS = {
  board: 'c1000000-0000-4000-8000-000000000001',
  empty: 'c1000000-0000-4000-8000-000000000002',
} as const

/** Labels of the seeded versions, oldest first. */
export const CMP_VERSIONS = {
  v1: 'Baseline',
  v2: 'After the billing rewrite',
  v2copy: 'Same as billing rewrite',
  v3: 'Layout pass',
} as const

/** Names the seed uses, so the spec can assert on them. */
export const CMP_NAMES = {
  cjkColumn: '暱稱',
  longTable: 'customer_subscription_billing_history_archive',
} as const
