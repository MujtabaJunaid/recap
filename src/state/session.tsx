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
 * There are two modes, and they are not equally strong.
 *
 * 1. PROXY CONFIGURED (VITE_API_BASE_URL set). Email and password go to
 *    POST /api/auth/login. The server verifies the password against an scrypt
 *    derivation — it stores no plaintext and the password is not recoverable from what
 *    it stores — and returns an HMAC-signed, expiring token. That token is required on
 *    every generation request and is verified server-side. This is real authentication:
 *    the client cannot mint or extend a token, because it does not have the signing key.
 *
 * 2. NO PROXY. There is no server to verify anything against, so the gate is an access
 *    *model*, not access *control*. It decides what the UI offers and protects nothing,
 *    which is acceptable only because nothing secret ships: the seed data is public
 *    fixture content.
 *
 * In both modes the password is held in a controlled input for the duration of the
 * submit and never stored, never logged, and never written to localStorage. Only the
 * token is persisted.
 *
 * Still server-side work, in either mode: share links should resolve by opaque token so
 * an unauthenticated viewer is never sent the surrounding meeting at all. The
 * client-side clip scoping is cosmetic by comparison.
 */

const STATE_VERSION = 2
const KEY = storageKey('session', STATE_VERSION)

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

/** Used only when there is no server to verify against. See the note above. */
const LOCAL_DEMO_PASSWORD = 'recap-demo-2026'

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export interface Session {
  status: SessionStatus
  userId: string | null
  email: string | null
  token: string | null
}

export type Capability = 'workspace:read' | 'workspace:write' | 'clip:share'

interface StoredSession {
  userId: string
  email: string
  /** Present only in proxy mode. Required by the generation endpoint. */
  token?: string
  expiresAt?: number
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

interface SessionApi extends Session {
  token: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  can: (capability: Capability) => boolean
}

const SessionContext = createContext<SessionApi | null>(null)

const ANONYMOUS: Session = { status: 'anonymous', userId: null, email: null, token: null }

function hydrate(raw: unknown): Session {
  const value = raw as Partial<StoredSession> | null
  if (!value || typeof value.userId !== 'string' || typeof value.email !== 'string') {
    return ANONYMOUS
  }
  // An expired token is the same as no session; do not present a signed-in shell that
  // cannot actually call anything.
  if (value.expiresAt && value.expiresAt < Date.now()) return ANONYMOUS

  return {
    status: 'authenticated',
    userId: value.userId,
    email: value.email,
    token: typeof value.token === 'string' ? value.token : null,
  }
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

  const signIn = useCallback(async (email: string, password: string) => {
    const trimmed = email.trim().toLowerCase()

    if (API_BASE) {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed, password }),
      })
      if (response.status === 401) throw new SignInError('Email or password is incorrect.')
      if (response.status === 429) throw new SignInError('Too many attempts. Try again shortly.')
      if (!response.ok) throw new SignInError('Could not reach the sign-in service.')

      const body = (await response.json()) as { token?: string; expiresAt?: number }
      if (!body.token) throw new SignInError('Sign-in service returned no token.')

      const next: StoredSession = {
        userId: ME,
        email: trimmed,
        token: body.token,
        expiresAt: body.expiresAt,
      }
      writeJSON(KEY, next)
      setSession({ status: 'authenticated', userId: ME, email: trimmed, token: body.token })
      return
    }

    // No server to verify against. Documented at the top of this file as a model, not
    // a control.
    if (password !== LOCAL_DEMO_PASSWORD) {
      throw new SignInError('Email or password is incorrect.')
    }
    const next: StoredSession = { userId: ME, email: trimmed || person(ME).name }
    writeJSON(KEY, next)
    setSession({ status: 'authenticated', userId: next.userId, email: next.email, token: null })
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
