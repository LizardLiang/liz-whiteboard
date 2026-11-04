// Imported first by src/router.tsx, before any module builds a Zod schema.
//
// Zod 4 probes `new Function('')` when a schema is created to enable its JIT
// validators. Under the production CSP (no 'unsafe-eval') the browser reports
// that probe as a violation even though Zod catches it, so the browser opts
// out of JIT up front. The server keeps JIT.
import { z } from 'zod'

if (typeof window !== 'undefined') z.config({ jitless: true })
