// src/lib/oauth/handlers/jwks.ts
// Nitro/H3 event handler for GET /.well-known/jwks.json
// Serves the RS256 public key in JWK Set format for token verification.
//
// Registered as a Nitro handler in vite.config.ts (see as-metadata.ts for
// the reason we use Nitro-level handlers for .well-known paths).

import { defineEventHandler, setHeader } from 'h3'
import { getJwks } from '../keys'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Cache-Control', 'public, max-age=300')

  const jwks = await getJwks()
  return jwks
})
