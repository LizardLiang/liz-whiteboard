//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
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
      // Deliberately-malformed fixtures for require-server-fn-authz.test.js
      // (read as text, not meant to parse) — excluded from tsconfig.json's
      // typed-linting project too; keep both in sync.
      'tools/eslint-rules/__fixtures__/**',
    ],
  },
  // The eslint-rule sources themselves are plain, untyped CommonJS/Node
  // scripts (not part of tsconfig.json's app project — see AD-2 above), so
  // they can't use type-aware linting. typescript-eslint's official
  // disableTypeChecked config unsets parserOptions.project/projectService
  // AND turns off type-checked rules for just this directory, rather than
  // weakening either globally.
  {
    files: ['tools/eslint-rules/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
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
  // Issue #130: enforce React hook correctness. Explicit rule block (not the
  // `recommended`/`recommended-latest` preset) so both severities are
  // guaranteed `error` regardless of plugin defaults.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]
