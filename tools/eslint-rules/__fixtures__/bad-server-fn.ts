// Bad fixture: createServerFn violations for ESLint rule self-tests

import { createServerFn } from '@tanstack/react-start'

declare function requireAuth(fn: any): any
declare function someOtherWrapper(fn: any): any

// Violation 1: No JSDoc at all
export const noJsDocFn = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(
    requireAuth(async ({ user }: any, id: string) => {
      return { id }
    }),
  )

// Violation 2: @requires editor JSDoc but no requireServerFnRole call
/**
 * @requires editor
 */
export const jsDocOnlyNoCallFn = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(
    requireAuth(async ({ user }: any, id: string) => {
      return { id }
    }),
  )

// Violation 3: Non-allowlisted wrapper
/**
 * @requires editor
 */
export const badWrapperFn = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(
    someOtherWrapper(async (ctx: any, id: string) => {
      return { id }
    }),
  )
