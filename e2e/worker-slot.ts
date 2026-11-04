// e2e/worker-slot.ts
// Single source of truth for the per-worker e2e stacks. Slot i owns one Vite
// dev server, one Socket.IO dev server, one SQLite file and one saved login
// session, so Playwright workers never share data.
//
// Playwright sets TEST_PARALLEL_INDEX (0..workers-1) in each worker process
// before it loads the config and the spec files. The main process has no such
// variable, so it reads slot 0.
import { resolve } from 'node:path'

const WEB_PORT_BASE = 3100
const PORT_STEP = 10
const DEFAULT_WORKERS = 3

/** True when specs target one already-running server (E2E_BASE_URL). */
export function usesExternalServer(): boolean {
  return Boolean(process.env.E2E_BASE_URL)
}

export function slotIndex(): number {
  const raw = Number(process.env.TEST_PARALLEL_INDEX)
  return Number.isInteger(raw) && raw >= 0 ? raw : 0
}

export function workerCount(): number {
  if (usesExternalServer()) return 1
  const raw = Number(process.env.E2E_WORKERS)
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_WORKERS
}

export function slotPorts(i: number): { web: number; socket: number } {
  const web = WEB_PORT_BASE + PORT_STEP * i
  return { web, socket: web + 1 }
}

export function slotDbPath(i: number): string {
  return resolve(process.cwd(), 'data', `e2e-w${i}.db`)
}

export function slotStorageState(i: number): string {
  return `e2e/.auth/state-w${i}.json`
}

export function slotViteCacheDir(i: number): string {
  return `node_modules/.vite-e2e-w${i}`
}
