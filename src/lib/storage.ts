/**
 * localStorage is unavailable or throws in several real situations: Safari private
 * browsing, embedded webviews, cookies-blocked settings, and quota exhaustion. Every
 * access goes through here so a storage failure degrades to in-memory state rather than
 * taking down the render.
 */

const PREFIX = 'recap'

export function storageKey(name: string, version: number): string {
  return `${PREFIX}:${name}:v${version}`
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return parsed === null || typeof parsed !== 'object' ? fallback : (parsed as T)
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing useful to do; the caller's in-memory state is already correct.
  }
}

/**
 * Fires when another tab writes the same key. Without this, two open tabs each hold
 * their own copy of workspace state and the last one to write silently wins.
 */
export function onExternalChange(key: string, handler: (next: string | null) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === key) handler(event.newValue)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
