// playwright.config.ts
// End-to-end config for the version-history suite (GH #107).
//
// Starts one dev stack per worker (default 3, ports 3100, 3110, ...). With
// E2E_BASE_URL set it starts none and targets that running server with one
// worker. Note the dev stack is a TWO-process split (Vite +
// server.dev.ts): the restore server fn runs in the Vite process where the
// Socket.IO `io` is null, so the live `whiteboard:restored` broadcast no-ops in
// dev — the restoring client must reload to see the change. That refresh works
// in the single-process prod build (server.prod.ts). The spec therefore
// asserts restore CORRECTNESS via an explicit reload, not the live broadcast.
//
// Viewport is 1600×1000: the "Version history" toolbar button sits in the
// toolbar's right overflow (~x=1413) and is off-screen at narrower widths.
import { delimiter, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from './e2e/fixtures'
import {
  slotDbPath,
  slotIndex,
  slotPorts,
  slotViteCacheDir,
  usesExternalServer,
  workerCount,
} from './e2e/worker-slot'

// Parallel e2e: every worker slot i has its own dev stack (Vite + Socket.IO),
// its own SQLite file and its own saved login (see e2e/worker-slot.ts). With
// E2E_BASE_URL set, no server is started and one worker uses that server.
// E2E_WORKERS=N changes the slot count (default 3).
//
// Playwright loads this file again inside each worker process, after it has
// set TEST_PARALLEL_INDEX, so `slotIndex()` below names the worker's own slot.
const WORKERS = workerCount()
const IN_WORKER = process.env.TEST_PARALLEL_INDEX !== undefined
if (IN_WORKER && !usesExternalServer()) {
  // Spec seed scripts (execFileSync) inherit this, so they write the slot's DB.
  process.env.E2E_DB_PATH = slotDbPath(slotIndex())
}

// webServer commands run without node_modules/.bin on PATH, but the dev stack
// command needs `concurrently`, `vite` and `dotenv`.
const PATH_KEY =
  Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
const SERVER_PATH = `${resolve('node_modules/.bin')}${delimiter}${process.env[PATH_KEY] ?? ''}`

function slotServer(i: number) {
  const { web, socket } = slotPorts(i)
  return {
    command: `concurrently "vite dev --host 0.0.0.0 --port ${web} --strictPort" "dotenv -e .env.local -- bun run server.dev.ts"`,
    url: `http://localhost:${web}`,
    // A stale stack on a slot port would serve another database. Fail instead.
    reuseExistingServer: false,
    // Up to 3 cold Vite compiles run at once.
    timeout: 300_000,
    env: {
      [PATH_KEY]: SERVER_PATH,
      DATABASE_URL: `file:${slotDbPath(i)}`,
      SOCKET_IO_DEV_PORT: String(socket),
      COLLAB_RESOURCE_URI: `http://localhost:${socket}`,
      VITE_CACHE_DIR: slotViteCacheDir(i),
      // board-render.spec.ts reads the same variable, default included.
      MCP_CLIENT_SECRET: process.env.MCP_CLIENT_SECRET ?? 'e2e-mcp-secret',
    },
  }
}

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
  workers: WORKERS,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    viewport: { width: 1600, height: 1000 },
    // Pin the browser language so specs asserting English text do not depend
    // on the host machine's language (the app follows navigator.languages).
    locale: 'en-US',
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
  // One dev stack per worker slot. None with E2E_BASE_URL (external server).
  webServer: usesExternalServer()
    ? undefined
    : Array.from({ length: WORKERS }, (_, i) => slotServer(i)),
})
