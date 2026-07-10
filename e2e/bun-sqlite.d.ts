// e2e/bun-sqlite.d.ts
// Minimal ambient typing for the `bun:sqlite` module, scoped to the surface
// e2e/seed.ts actually uses. This script is executed under Bun (`bun run
// e2e/seed.ts`) even though the Playwright test runner itself is Node — see
// CLAUDE.md's E2E seeding notes. The full `bun-types` package isn't installed
// (and would pull in ambient globals — Bun's fetch/WebSocket/etc. — that
// could collide with this project's DOM lib), so this file declares only the
// `Database` shape this script needs rather than widening global type
// resolution project-wide.
declare module 'bun:sqlite' {
  interface SqliteStatement {
    get: (...params: Array<unknown>) => unknown
    all: (...params: Array<unknown>) => Array<unknown>
    run: (...params: Array<unknown>) => unknown
  }

  export class Database {
    constructor(filename?: string, options?: unknown)
    exec(sql: string): void
    query(sql: string): SqliteStatement
    prepare(sql: string): SqliteStatement
    close(): void
  }
}
