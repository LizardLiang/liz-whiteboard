// src/test/setup.ts
// Vitest test setup file — runs before each test file

import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'

// Add jest-axe matchers to vitest expect
expect.extend(toHaveNoViolations)

// Automatically clean up after each test
// This removes rendered components from the DOM
afterEach(() => {
  cleanup()
})
