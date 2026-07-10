import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    viteReact(),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright E2E specs live under dogfood-output/ and e2e/ and require
    // @playwright/test's own `test`/`expect`, which is incompatible with
    // Vitest's globals. Exclude both so Vitest doesn't try to collect them
    // (pre-existing gap — e2e/ was missing here, so `bun run test` was
    // already trying and failing to collect every e2e/*.spec.ts; surfaced
    // while adding e2e/react-flow-perf.spec.ts for GH #121).
    exclude: ['dogfood-output/**', 'e2e/**', 'node_modules/**'],
    // Safety: tests must never touch the real database file. Any test that
    // imports `@/db` gets a throwaway in-memory SQLite instance.
    env: {
      DATABASE_URL: ':memory:',
    },
  },
})
