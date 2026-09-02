// playwright.config.ts
// End-to-end config for the version-history suite (GH #107).
//
// Targets an already-running dev server (default http://localhost:3001 — set
// E2E_BASE_URL to override). Note the dev stack is a TWO-process split (Vite +
// server.dev.ts): the restore server fn runs in the Vite process where the
// Socket.IO `io` is null, so the live `whiteboard:restored` broadcast no-ops in
// dev — the restoring client must reload to see the change. That refresh works
// in the single-process prod build (server.prod.ts). The spec therefore
// asserts restore CORRECTNESS via an explicit reload, not the live broadcast.
//
// Viewport is 1600×1000: the "Version history" toolbar button sits in the
// toolbar's right overflow (~x=1413) and is off-screen at narrower widths.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from './e2e/fixtures'

export default defineConfig({
  testDir: './e2e',
  // GH #125: coedit-table-create.spec.ts requires the PROD build (dev's
  // Socket.IO `io` is null there) and runs under its own dedicated config
  // (playwright.coedit.config.ts / `bunx playwright test
  // --config=playwright.coedit.config.ts`) — excluded here so the default
  // dev-server suite doesn't try to run it against the wrong server.
  // mcp-cimd-open.spec.ts needs the app process started with
  // CIMD_TEST_ORIGINS so the AS will fetch its local metadata server; this
  // config reuses whatever dev server is already running, which would not
  // have it. It runs under playwright.cimd.config.ts
  // (`bun run test:e2e:cimd`) instead.
  testIgnore: ['**/coedit-table-create.spec.ts', '**/mcp-cimd-open.spec.ts'],
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
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
    // Firefox, scoped via `testMatch` to ONLY canvas-grouping.spec.ts
    // (canvas-element-grouping tactical plan, Wave 8 / FR-020's NFR: Ctrl+G
    // must suppress the browser's native shortcut in more than one engine).
    // Every other existing spec still runs chromium-only — `testMatch` here
    // overrides this project's own file selection rather than adding to the
    // suite-wide default, so this does not double the runtime of, or
    // introduce first-time Firefox exposure for, any spec that was never
    // written or verified against it.
    {
      name: 'firefox',
      testMatch: /canvas-grouping\.spec\.ts$/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  // Reuse the dev server if it's already up on BASE_URL; otherwise start it.
  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
