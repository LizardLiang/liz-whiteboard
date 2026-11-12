import { configDefaults, defineConfig } from 'vitest/config'
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
    // Collect only the project's own unit tests. Playwright specs (e2e/,
    // dogfood-output/) use @playwright/test's `test`/`expect`; build output
    // and agent worktrees under .claude/ hold stale copies of src/ and their
    // own node_modules. configDefaults.exclude keeps `**/node_modules/**`.
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      '.output/**',
      '.tanstack/**',
      'dist/**',
      'dogfood-output/**',
      'e2e/**',
      'test-results/**',
    ],
    // Safety: tests must never touch the real database file. Any test that
    // imports `@/db` gets a throwaway in-memory SQLite instance.
    env: {
      DATABASE_URL: ':memory:',
    },
  },
})
