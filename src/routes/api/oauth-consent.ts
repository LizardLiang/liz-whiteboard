// src/routes/api/oauth-consent.ts
// Consent server functions for src/routes/oauth/consent.tsx. Follows
// src/routes/api/invites.ts's exact shape: createServerFn + requireAuth,
// deliberately THIN — handler bodies live in src/lib/oauth/consent-handlers.ts
// so this file's node:crypto/@/db-touching imports never reach the client
// bundle (see that module's header comment for the full rationale).

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  approveConsentHandler,
  denyConsentHandler,
  getConsentRequestHandler,
} from '@/lib/oauth/consent-handlers'
import { consentRequestIdSchema } from '@/data/schema'

/**
 * @requires authenticated
 */
export const getConsentRequest = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => consentRequestIdSchema.parse(data))
  .handler(requireAuth(getConsentRequestHandler))

/**
 * @requires authenticated
 */
export const approveConsent = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => consentRequestIdSchema.parse(data))
  .handler(requireAuth(approveConsentHandler))

/**
 * @requires authenticated
 */
export const denyConsent = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => consentRequestIdSchema.parse(data))
  .handler(requireAuth(denyConsentHandler))
