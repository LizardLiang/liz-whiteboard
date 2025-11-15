//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

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
]
