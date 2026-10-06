import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon, ICONS } from './primitives'
import { avatarColor } from '../data/people'
import { useSession } from '../state/session'
import { useWorkspace } from '../state/workspace'
import { MEETINGS } from '../data'
import { relativeDay } from '../lib/format'

const NAV = [
  { to: '/', label: 'Meetings', icon: ICONS.home, end: true },
  { to: '/actions', label: 'Action items', icon: ICONS.check, end: false },
  { to: '/highlights', label: 'Highlights', icon: ICONS.scissors, end: false },
]

function useQueryParam(key: string): string {
  const { search } = useLocation()
  return new URLSearchParams(search).get(key) ?? ''
}

/** "ada.lovelace@acme.io" -> "Ada Lovelace", "AL". Good enough and better than a guess. */
function identityFrom(email: string | null) {
  const local = (email ?? '').split('@')[0] || 'you'
  const words = local.split(/[._-]+/).filter(Boolean)
  const name = words.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'You'
  const initials = (words.length > 1
    ? words[0][0] + words[words.length - 1][0]
    : local.slice(0, 2)
  ).toUpperCase()
  return { name, initials, org: (email ?? '').split('@')[1] ?? '' }
}

export function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { email, signOut } = useSession()
  const { hasMeetings } = useWorkspace()
  const me = identityFrom(email)
  const initial = useQueryParam('q')
  const [query, setQuery] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const location = useLocation()

  useEffect(() => {
    setQuery(initial)
  }, [initial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === input.current) {
        input.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/')
  }

  const upcoming = hasMeetings ? MEETINGS.filter((m) => m.status === 'processing') : []

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900 px-3 py-4 lg:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/25">
            <Icon path={ICONS.play} className="h-3.5 w-3.5 fill-white text-white" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">Recap</span>
        </Link>

        <nav className="space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-ink-800 font-medium text-white'
                    : 'text-ink-300 hover:bg-ink-850 hover:text-ink-200'
                }`
              }
            >
              <Icon path={item.icon} className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={`mt-7 px-2.5 ${hasMeetings ? '' : 'hidden'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Recent</p>
          <div className="mt-2 space-y-0.5">
            {MEETINGS.filter((m) => m.status === 'ready')
              .slice(0, 5)
              .map((m) => (
                <Link
                  key={m.id}
                  to={`/m/${m.id}`}
                  className={`block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                    location.pathname === `/m/${m.id}`
                      ? 'bg-ink-800 text-white'
                      : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
                  }`}
                  title={m.title}
                >
                  {m.title}
                </Link>
              ))}
          </div>
        </div>

        {upcoming.length > 0 && (
          <div className="mt-6 rounded-lg border border-ink-800 bg-ink-850 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-brand-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
              </span>
              Processing
            </div>
            {upcoming.map((m) => (
              <p key={m.id} className="mt-1.5 text-[12px] leading-snug text-ink-300">
                {m.title}
                <span className="block text-ink-400">{relativeDay(m.date)} · transcribing</span>
              </p>
            ))}
          </div>
        )}

        <div className="mt-auto space-y-1">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(email ?? 'you')}`}
            >
              {me.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink-200">{me.name}</p>
              <p className="truncate text-[11px] text-ink-400">{email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-200"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur md:px-6">
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500">
              <Icon path={ICONS.play} className="h-3 w-3 fill-white text-white" />
            </span>
          </Link>
          <form onSubmit={submit} className="relative flex-1 max-w-xl">
            <Icon
              path={ICONS.search}
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across every meeting"
              className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2 pl-9 pr-16 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] font-medium text-ink-400">
              ⌘K
            </kbd>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-ink-300 sm:inline-flex">
              <Icon path={ICONS.calendar} className="h-3.5 w-3.5" />
              Calendar connected
            </span>
            <span
              title={email ?? undefined}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(email ?? 'you')}`}
            >
              {me.initials}
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
