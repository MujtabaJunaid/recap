import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'

export function SignIn() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('priya@northbeam.io')
  const [error, setError] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError('Enter an email address so we know which workspace to open.')
      return
    }
    signIn(value)
    navigate(from, { replace: true })
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
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError('')
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'email-error' : undefined}
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
            />
            {error && (
              <p id="email-error" className="mt-1.5 text-[12px] text-rose-400">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Continue
          </button>
        </form>

        <p className="mt-5 rounded-lg border border-ink-800 bg-ink-900 p-3 text-[12px] leading-relaxed text-ink-400">
          This build has no server, so sign-in is a demo gate rather than a security
          boundary — any valid-looking address opens the same seeded workspace. Shared clip
          links stay public by design and never require this step.
        </p>
      </div>
    </div>
  )
}
