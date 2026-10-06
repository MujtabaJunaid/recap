import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ME, person } from '../data/people'
import { onExternalChange, readJSON, removeKey, storageKey, writeJSON } from '../lib/storage'

/**
 * SECURITY BOUNDARY — read this before extending.
 *
 * This build has no server. Everything below runs in the browser, so it is an access
 * *model*, not an access *control*: it decides what the UI offers, and a determined
 * viewer can bypass all of it with devtools. Nothing secret is protected by it, because
 * nothing secret is shipped — the seed data is public fixture content.
 *
 * The shape is deliberately the one a real implementation needs, so the swap is
 * mechanical rather than a rewrite:
 *
 *   - `signIn` becomes a call that exchanges credentials for a short-lived token.
 *   - `Session.user` is derived from a verified token, never from client-supplied input.
 *   - `can()` moves server-side and is re-checked on every data-returning request.
 *   - Share links resolve server-side by opaque token; the clip payload is fetched by
 *     that token and scoped to the clip, so an unauthenticated viewer is never sent the
 *     surrounding meeting at all. The client-side scoping here is cosmetic by comparison.
 */

const STATE_VERSION = 1
const KEY = storageKey('session', STATE_VERSION)

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export interface Session {
  status: SessionStatus
  userId: string | null
  email: string | null
}

export type Capability = 'workspace:read' | 'workspace:write' | 'clip:share'

interface StoredSession {
  userId: string
  email: string
}

interface SessionApi extends Session {
  signIn: (email: string) => void
  signOut: () => void
  can: (capability: Capability) => boolean
}

const SessionContext = createContext<SessionApi | null>(null)

const ANONYMOUS: Session = { status: 'anonymous', userId: null, email: null }

function hydrate(raw: unknown): Session {
  const value = raw as Partial<StoredSession> | null
  if (!value || typeof value.userId !== 'string' || typeof value.email !== 'string') {
    return ANONYMOUS
  }
  return { status: 'authenticated', userId: value.userId, email: value.email }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(() => hydrate(readJSON(KEY, null)))

  useEffect(
    () =>
      onExternalChange(KEY, (next) => {
        // Signing out in one tab must sign out the others.
        setSession(hydrate(next ? safeParse(next) : null))
      }),
    [],
  )

  const signIn = useCallback((email: string) => {
    const trimmed = email.trim().toLowerCase()
    const next: StoredSession = { userId: ME, email: trimmed || person(ME).name }
    writeJSON(KEY, next)
    setSession({ status: 'authenticated', userId: next.userId, email: next.email })
  }, [])

  const signOut = useCallback(() => {
    removeKey(KEY)
    setSession(ANONYMOUS)
  }, [])

  const api = useMemo<SessionApi>(
    () => ({
      ...session,
      signIn,
      signOut,
      can: (capability) => {
        if (session.status !== 'authenticated') return false
        // One role in this build. A real implementation resolves this from the token.
        return (
          capability === 'workspace:read' ||
          capability === 'workspace:write' ||
          capability === 'clip:share'
        )
      },
    }),
    [session, signIn, signOut],
  )

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside a SessionProvider')
  return ctx
}
