// e2e/busy-report.ts
// Import this first in a script that opens the e2e SQLite file. When the
// script dies with SQLITE_BUSY ("database is locked"), it prints the seed step
// that hit the lock and every process that holds the database, -wal or -shm
// file open, then fails as before. A busy_timeout of 30 s hides short waits but
// does not name a holder that keeps the lock, so the next occurrence shows it.
import { spawnSync } from 'node:child_process'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

function isBusy(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return (
    e?.code === 'SQLITE_BUSY' ||
    /SQLITE_BUSY|database is locked/i.test(e?.message ?? '')
  )
}

/** The first stack frame outside this file and node/bun internals: the seed step. */
function seedStep(err: unknown): string {
  const frames = String((err as Error | null)?.stack ?? '').split('\n')
  return (
    frames
      .find((f) => f.includes('/e2e/') && !f.includes('busy-report'))
      ?.trim() ?? 'unknown (no e2e frame in the stack)'
  )
}

function holders(path: string): string {
  const tools: Array<[string, Array<string>]> = [
    ['fuser', ['-v', path, `${path}-wal`, `${path}-shm`]],
    ['lsof', [path, `${path}-wal`, `${path}-shm`]],
  ]
  for (const [cmd, args] of tools) {
    const run = spawnSync(cmd, args, { encoding: 'utf8' })
    if (run.error) continue
    // fuser writes its table to stderr, lsof to stdout.
    const out = `${run.stdout}${run.stderr}`.trim()
    return `${cmd} ${args.join(' ')}\n${out || '(no process holds the files open now)'}`
  }
  return '(neither fuser nor lsof is installed)'
}

process.on('uncaughtException', (err) => {
  if (isBusy(err)) {
    console.error(
      `[seed] SQLITE_BUSY on ${DB_PATH}\n[seed] step: ${seedStep(err)}\n[seed] holders:\n${holders(DB_PATH)}`,
    )
  }
  console.error(err)
  process.exit(1)
})
