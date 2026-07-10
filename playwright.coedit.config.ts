// playwright.coedit.config.ts
// Dedicated Playwright config for the prod-build, two-context co-editing
// suite (GH #125: e2e/coedit-table-create.spec.ts). Kept SEPARATE from
// playwright.config.ts (which targets the dev server and reuses it if
// already running) because this suite specifically requires the
// SINGLE-PROCESS prod build: dev's Vite/server.dev.ts split runs server
// functions in the Vite process where Socket.IO's `io` is null, so the live
// `table:created` broadcast this suite exists to prove would silently no-op
// there — the same reason playwright.config.ts's version-history suite
// verifies restore correctness via reload rather than the live broadcast.
//
// Run: bunx playwright test --config=playwright.coedit.config.ts
// (builds once, boots server.prod.ts on COEDIT_PORT, then runs the spec.)
import { defineConfig, devices } from '@playwright/test'
import { COEDIT_BASE_URL, COEDIT_PORT } from './e2e/fixtures-collab'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'coedit-table-create.spec.ts',
  globalSetup: './e2e/global-setup-collab.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: COEDIT_BASE_URL,
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
  // Builds the Nitro/prod bundle then boots the single-process prod server
  // (server.prod.ts) on a fixed test port so it never collides with a
  // locally-running dev server (default port 3000/3001).
  webServer: {
    command: `bun run build && PORT=${COEDIT_PORT} ./node_modules/.bin/dotenv -e .env.local -- bun run server.prod.ts`,
    url: COEDIT_BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
