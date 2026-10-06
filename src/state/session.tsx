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
  displayName: string | null
  token: string | null
  hasAccount: boolean
}

export type Capability = 'workspace:read' | 'workspace:write' | 'clip:share'

interface StoredSession {
  userId: string
  email: string
  displayName?: string
  /** Present only in proxy mode. Required by the generation endpoint. */
  token?: string
  expiresAt?: number
  /** Backed by a row in the users table, as opposed to the shared demo credential. */
  hasAccount?: boolean
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
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => void
  can: (capability: Capability) => boolean
  /** True when the session is backed by a real account rather than the shared demo. */
  hasAccount: boolean
}

export const MIN_PASSWORD_LENGTH = 10
export const accountsEnabled = Boolean(API_BASE)

const SessionContext = createContext<SessionApi | null>(null)

const ANONYMOUS: Session = {
  status: 'anonymous',
  userId: null,
  email: null,
  displayName: null,
  token: null,
  hasAccount: false,
}

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
    displayName: value.displayName ?? null,
    token: typeof value.token === 'string' ? value.token : null,
    hasAccount: value.hasAccount === true,
  }
}

interface AuthResponse {
  token?: string
  expiresAt?: number
  user?: { email?: string; displayName?: string }
}

async function readAuthError(response: Response, fallback: string): Promise<never> {
  if (response.status === 429) throw new SignInError('Too many attempts. Try again shortly.')
  let detail = ''
  try {
    const body = (await response.json()) as { error?: string; details?: string[] }
    detail = body.details?.join('. ') || body.error || ''
  } catch {
    // Non-JSON error body; fall through to the generic message.
  }
  throw new SignInError(detail || fallback)
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

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (!API_BASE) {
        throw new SignInError('Accounts need the backend, which is not configured here.')
      }
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, displayName }),
      })
      if (response.status === 409) {
        throw new SignInError('An account with that email already exists. Sign in instead.')
      }
      if (!response.ok) await readAuthError(response, 'Could not create the account.')

      const body = (await response.json()) as AuthResponse
      if (!body.token) throw new SignInError('Sign-up returned no token.')

      const next: StoredSession = {
        userId: ME,
        email: body.user?.email ?? email.trim().toLowerCase(),
        displayName: body.user?.displayName ?? '',
        token: body.token,
        expiresAt: body.expiresAt,
        hasAccount: true,
      }
      writeJSON(KEY, next)
      setSession({
        status: 'authenticated',
        userId: ME,
        email: next.email,
        displayName: next.displayName ?? null,
        token: body.token,
        hasAccount: true,
      })
    },
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
      if (!response.ok) await readAuthError(response, 'Could not reach the sign-in service.')

      const body = (await response.json()) as AuthResponse
      if (!body.token) throw new SignInError('Sign-in service returned no token.')

      // A shared-demo session carries no account row, so its state stays in the browser.
      const hasAccount = Boolean(body.user?.displayName !== undefined && body.user?.email)
      const next: StoredSession = {
        userId: ME,
        email: body.user?.email ?? trimmed,
        displayName: body.user?.displayName ?? '',
        token: body.token,
        expiresAt: body.expiresAt,
        hasAccount,
      }
      writeJSON(KEY, next)
      setSession({
        status: 'authenticated',
        userId: ME,
        email: next.email,
        displayName: next.displayName ?? null,
        token: body.token,
        hasAccount,
      })
      return
    }

    // No server to verify against. Documented at the top of this file as a model, not
    // a control.
    if (password !== LOCAL_DEMO_PASSWORD) {
      throw new SignInError('Email or password is incorrect.')
    }
    const next: StoredSession = { userId: ME, email: trimmed || person(ME).name }
    writeJSON(KEY, next)
    setSession({
      status: 'authenticated',
      userId: next.userId,
      email: next.email,
      displayName: null,
      token: null,
      hasAccount: false,
    })
  }, [])

  const signOut = useCallback(() => {
    removeKey(KEY)
    setSession(ANONYMOUS)
  }, [])

  const api = useMemo<SessionApi>(
    () => ({
      ...session,
      signIn,
      signUp,
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
    [session, signIn, signUp, signOut],
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
