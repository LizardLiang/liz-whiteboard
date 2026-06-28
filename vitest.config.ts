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
    // Safety: tests must never touch the real database file. Any test that
    // imports `@/db` gets a throwaway in-memory SQLite instance.
    env: {
      DATABASE_URL: ':memory:',
    },
  },
})
