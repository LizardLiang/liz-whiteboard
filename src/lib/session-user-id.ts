import { safeGetItem, safeSetItem } from './safe-storage'
import { uuid } from './uuid'

/**
 * Returns a stable anonymous user ID for the current browser session.
 *
 * The ID is a random UUID generated once per browser tab/session and stored
 * in sessionStorage so it survives re-renders but is refreshed on a new tab
 * or after the tab is closed.
 *
 * This is an anonymous, unauthenticated user ID used to track presence in
 * collaboration sessions until proper authentication is implemented.
 */
const SESSION_USER_ID_KEY = 'liz-whiteboard:session-user-id'

// Kept in memory so the id stays stable for the page's life when
// sessionStorage is missing or rejects writes.
let memoryId: string | null = null

export function getSessionUserId(): string {
  if (typeof sessionStorage === 'undefined') {
    return uuid()
  }
  if (memoryId) return memoryId
  const existing = safeGetItem(SESSION_USER_ID_KEY, 'session')
  if (existing) {
    memoryId = existing
    return existing
  }
  memoryId = uuid()
  safeSetItem(SESSION_USER_ID_KEY, memoryId, 'session')
  return memoryId
}
