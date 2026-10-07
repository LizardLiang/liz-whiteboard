// Web Storage access that never throws: storage can be blocked (private
// mode, policy) or full, and a preference that cannot be saved must not stop
// the page from rendering.

export type StorageKind = 'local' | 'session'

function area(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

/** Read a stored value, or null when the key is unset or storage is unavailable. */
export function safeGetItem(
  key: string,
  kind: StorageKind = 'local',
): string | null {
  try {
    return area(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Write a value and report whether storage accepted it. */
export function safeSetItem(
  key: string,
  value: string,
  kind: StorageKind = 'local',
): boolean {
  try {
    const target = area(kind)
    if (!target) return false
    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}
