// e2e/fixtures.ts
// Shared constants for the Playwright end-to-end suite. IDs are FIXED (not
// random) so the seed script and the specs agree without passing state
// between the Node (Playwright) and Bun (seed) runtimes.

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

export const E2E_USER = {
  username: 'e2e_dogfood',
  email: 'e2e_dogfood@example.com',
  password: 'E2eDogfood123!',
}

// Deterministic, valid-v4-shaped UUIDs (server-fn Zod validates .uuid()).
export const IDS = {
  user: '11111111-1111-4111-8111-111111111111',
  project: '22222222-2222-4222-8222-222222222222',
  whiteboard: '33333333-3333-4333-8333-333333333333',
  usersTable: '44444444-4444-4444-8444-444444444444',
  ordersTable: '55555555-5555-4555-8555-555555555555',
  usersId: '66666666-6666-4666-8666-666666666666',
  usersEmail: '77777777-7777-4777-8777-777777777777',
  ordersId: '88888888-8888-4888-8888-888888888888',
  ordersUserId: '99999999-9999-4999-8999-999999999999',
  relationship: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  area: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

export const STORAGE_STATE = 'e2e/.auth/state.json'
