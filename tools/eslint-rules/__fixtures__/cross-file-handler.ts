// tools/eslint-rules/__fixtures__/cross-file-handler.ts
// Fixture for TC-ESLINT-12: a handler function declared in a SEPARATE file
// from the createServerFn wrapper that references it (mirrors
// src/lib/invite/handlers.ts's relationship to src/routes/api/invites.ts —
// handler logic kept out of the wrapper's own file so client-imported
// sibling exports don't drag server-only data-layer imports into the
// client bundle).

export async function requireMinimumRole(
  userId: string,
  projectId: string,
  minRole: string,
  message: string,
): Promise<{ error: 'FORBIDDEN' } | null> {
  return null
}

export async function guardedHandler(ctx: any, data: any) {
  const denial = await requireMinimumRole(
    ctx.user.id,
    data.projectId,
    'ADMIN',
    'nope',
  )
  if (denial) return denial
  return { success: true }
}

export async function unguardedHandler(ctx: any, data: any) {
  return { data: 'sensitive' }
}
