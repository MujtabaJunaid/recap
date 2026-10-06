import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { accountsEnabled, MIN_PASSWORD_LENGTH, SignInError, useSession } from '../state/session'

const HOSTED = accountsEnabled

export function SignIn() {
  const { signIn, signUp } = useSession()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [displayName, setDisplayName] = useState('')
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
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setBusy(true)
    try {
      if (mode === 'signup') await signUp(value, password, displayName.trim())
      else await signIn(value, password)
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: the form. Right: what you are signing in to, so the page is not a
          floating box on a void. The panel is hidden below lg, where it would just
          push the form off-screen. */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/30">
            <Icon path={ICONS.play} className="h-4 w-4 fill-white text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Recap</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-white">
          {mode === 'signup' ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-[13px] text-ink-400">
          {mode === 'signup'
            ? 'Your own workspace state: completed actions, clips and work style, kept to your account.'
            : 'Your meetings, transcripts and action items live behind this.'}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
          {mode === 'signup' && (
            <div>
              <label
                htmlFor="displayName"
                className="mb-1.5 block text-[12px] font-medium text-ink-300"
              >
                Your name <span className="text-ink-500">(optional)</span>
              </label>
              <input
                id="displayName"
                name="name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          )}

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
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
            {busy
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : 'Continue'}
          </button>

          {HOSTED && (
            <p className="text-center text-[12px] text-ink-400">
              {mode === 'signup' ? 'Already have an account?' : 'No account yet?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signup' ? 'signin' : 'signup')
                  setError('')
                  setPassword('')
                }}
                className="text-brand-400 hover:underline"
              >
                {mode === 'signup' ? 'Sign in' : 'Create one'}
              </button>
            </p>
          )}
        </form>

        <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900 p-3">
          <p className="text-[12px] font-medium text-ink-200">
            {HOSTED ? 'Just looking?' : 'Demo credentials'}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
            {HOSTED ? (
              <>
                Sign in as{' '}
                <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-ink-200">
                  demo@recap.app
                </code>{' '}
                /{' '}
                <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-ink-200">
                  recap-demo-2026
                </code>
                , or create your own account above — that one is a normal account with
                its own password, not a key that opens every address.
              </>
            ) : (
              <>
                Any email address, password{' '}
                <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-ink-200">
                  recap-demo-2026
                </code>
                .
              </>
            )}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            {HOSTED
              ? 'Every account has its own password, hashed with scrypt and stored one-way — nobody, including us, can read yours back. Your completed actions, clips and work style are yours alone.'
              : 'No backend is configured for this build, so this gate is a demo, not a security boundary. Shared clip links stay public by design and never require it.'}
          </p>
        </div>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-ink-800 bg-ink-900 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(620px 420px at 78% 12%, rgb(99 102 241 / 0.22), transparent 62%), radial-gradient(520px 380px at 18% 88%, rgb(20 184 166 / 0.14), transparent 60%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-center px-12 py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400">
            After the call
          </p>
          <h2 className="mt-3 max-w-md text-[26px] font-semibold leading-tight tracking-tight text-white">
            Every decision, who owns it, and the thirty seconds that prove it.
          </h2>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-ink-300">
            Recap records, transcribes and summarises your meetings, then makes the
            result navigable instead of another hour of video nobody rewatches.
          </p>

          <ul className="mt-8 max-w-md space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/25 bg-brand-500/10">
                  <Icon path={item.icon} className="h-3.5 w-3.5 text-brand-400" />
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-ink-100">
                    {item.title}
                  </span>
                  <span className="block text-[12px] leading-relaxed text-ink-400">
                    {item.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex max-w-md items-center gap-5 border-t border-ink-800 pt-5">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <p className="font-mono text-[18px] tabular-nums text-white">{stat.value}</p>
                <p className="text-[11px] text-ink-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}

const HIGHLIGHTS = [
  {
    icon: ICONS.sparkle,
    title: 'Summaries you can re-cut',
    detail: 'Seven templates over the same transcript. A standup and a board review are not the same read.',
  },
  {
    icon: ICONS.check,
    title: 'Action items that link back',
    detail: 'Every commitment jumps to the second it was made, so nobody relitigates what was agreed.',
  },
  {
    icon: ICONS.scissors,
    title: 'Clips anyone can open',
    detail: 'Share thirty seconds with someone who was not there. No account, and nothing else leaks.',
  },
  {
    icon: ICONS.chart,
    title: 'Who actually talked',
    detail: 'Talk time, turns and silence. Uninteresting on a 1:1, the whole story on an eight-person hour.',
  },
]

const STATS = [
  { value: '8', label: 'seeded meetings' },
  { value: '58m', label: 'longest call' },
  { value: '7', label: 'summary templates' },
]
