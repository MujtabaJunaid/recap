import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { SignInError, useSession } from '../state/session'

const HOSTED = Boolean(import.meta.env?.VITE_API_BASE_URL)

export function SignIn() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('priya@northbeam.io')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const value = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length === 0) {
      setError('Enter your password.')
      return
    }

    setBusy(true)
    try {
      await signIn(value, password)
      // The password lives only as long as the submit that used it.
      setPassword('')
      navigate(from, { replace: true })
    } catch (err) {
      setError(
        err instanceof SignInError ? err.message : 'Something went wrong. Try again.',
      )
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
            <Icon path={ICONS.play} className="h-4 w-4 fill-white text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Recap</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-white">Sign in</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Your meetings, transcripts and action items live behind this.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[12px] font-medium text-ink-300">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError('')
              }}
              aria-invalid={Boolean(error)}
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-[12px] font-medium text-ink-300"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'signin-error' : undefined}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 pr-16 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-[11px] text-ink-400 transition-colors hover:text-ink-200"
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <p id="signin-error" role="alert" className="text-[12px] text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900 p-3">
          <p className="text-[12px] font-medium text-ink-200">Demo credentials</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
            Any email address, password{' '}
            <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-ink-200">
              recap-demo-2026
            </code>
            .
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            {HOSTED
              ? 'The password is verified server-side against an scrypt derivation; no plaintext is stored anywhere, and a signed, expiring token is issued on success.'
              : 'No backend is configured for this build, so this gate is a demo, not a security boundary. Shared clip links stay public by design and never require it.'}
          </p>
        </div>
      </div>
    </div>
  )
}
