// playwright.cimd.config.ts
// Dedicated Playwright config for the open-CIMD consent suite
// (mcp-oauth-open-cimd: e2e/mcp-cimd-open.spec.ts). Kept SEPARATE from
// playwright.config.ts for one reason: the authorization server fetches a
// client's metadata document SERVER-side, so the app process itself must be
// told the test origin is fetchable (CIMD_TEST_ORIGINS). The default config
// reuses an already-running dev server, which would not carry that env, so
// this one boots its own on a dedicated port with `reuseExistingServer: false`.
//
// It must be the DEV server, not the prod build (unlike
// playwright.coedit.config.ts): CIMD_TEST_ORIGINS is ignored outright when
// NODE_ENV=production — that refusal is the whole point of the flag, and a
// prod-build run would correctly reject the test origin and fail.
//
// Run: bun run test:e2e:cimd
import { defineConfig, devices } from '@playwright/test'

const PORT = 3099
const CIMD_BASE_URL = `http://localhost:${PORT}`

// Must match CIMD_ORIGIN in e2e/mcp-cimd-open.spec.ts.
const CIMD_TEST_ORIGIN = 'http://127.0.0.1:39311'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'mcp-cimd-open.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: CIMD_BASE_URL,
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 1600, height: 1000 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  webServer: {
    // Vite dev only — this suite exercises OAuth routes, not Socket.IO, so
    // the collab server (server.dev.ts) is not needed.
    command: `CIMD_TEST_ORIGINS='["${CIMD_TEST_ORIGIN}"]' ./node_modules/.bin/dotenv -e .env.local -- vite dev --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: CIMD_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
