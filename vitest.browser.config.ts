import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    react(),
  ],
  test: {
    // Browser mode: run component tests in real browser
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          headless: !!process.env.CI,
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.browser.test.{ts,tsx}'],
  },
})
