//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// AD-2: Load the require-server-fn-authz rule from a separate CJS file.
// The rule uses CommonJS exports (ESLint 9 flat-config compatible).
const require = createRequire(import.meta.url)
const requireServerFnAuthzRule = require(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    'tools/eslint-rules/require-server-fn-authz.cjs',
  ),
)

// Inline plugin definition (AD-2: no separate npm package, no build step)
const secAuthzPlugin = {
  rules: {
    'require-server-fn-authz': requireServerFnAuthzRule,
  },
}

export default [
  ...tanstackConfig,
  {
    ignores: [
      // Config files
      '*.config.js',
      'eslint.config.js',
      'prettier.config.js',
      // Dependencies
      'node_modules',
      // Build outputs
      'dist',
      'dist-ssr',
      'build',
      '.output',
      '.vinxi',
      '.nitro',
      // Generated files
      'src/routeTree.gen.ts',
      '*.min.js',
      // Testing
      'coverage',
      // TanStack Start internals
      '.tanstack',
    ],
  },
  // SEC-RBAC-04: AST guard — all createServerFn exports must carry @requires JSDoc
  // and call requireServerFnRole (unless using authenticated/unauthenticated escape hatch).
  // Scoped to src/**/*.{ts,tsx} excluding test files and demo paths.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.{ts,tsx}',
      '**/*.test.ts',
      'src/data/demo.*',
      'src/routes/demo/**',
    ],
    plugins: {
      'sec-authz': secAuthzPlugin,
    },
    rules: {
      'sec-authz/require-server-fn-authz': 'error',
    },
  },
]
