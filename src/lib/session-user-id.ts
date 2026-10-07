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

export function getSessionUserId(): string {
  if (typeof sessionStorage === 'undefined') {
    return uuid()
  }
  const existing = safeGetItem(SESSION_USER_ID_KEY, 'session')
  if (existing) {
    return existing
  }
  const id = uuid()
  safeSetItem(SESSION_USER_ID_KEY, id, 'session')
  return id
}
