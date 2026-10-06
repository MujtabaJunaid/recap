import { Link } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'
import { useWorkspace } from '../state/workspace'

/**
 * What a brand-new account sees.
 *
 * A fresh workspace is genuinely empty — a new user has recorded nothing, and
 * pretending otherwise by dropping someone else's meetings into their account is both
 * confusing and dishonest. So this is a real first-run state: it says what happens
 * next, and offers one button to load the sample workspace for anyone who wants to look
 * around before committing a calendar to it.
 */

const STEPS = [
  {
    icon: ICONS.calendar,
    title: 'Connect a calendar',
    detail: 'Recap sees what is scheduled and joins the ones you ask it to.',
    status: 'Connected' as const,
  },
  {
    icon: ICONS.play,
    title: 'Let it join a call',
    detail: 'It records, transcribes and separates who said what.',
    status: 'Waiting for your first meeting' as const,
  },
  {
    icon: ICONS.sparkle,
    title: 'Read what came out',
    detail: 'Summary, action items with owners, and clips you can share.',
    status: 'After your first recording' as const,
  },
]

export function EmptyWorkspace() {
  const { displayName, email } = useSession()
  const { loadSampleWorkspace } = useWorkspace()
  const firstName = (displayName || email?.split('@')[0] || 'there').split(' ')[0]

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="rise">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 text-[11px] font-medium text-brand-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
          </span>
          Ready and listening
        </span>

        <h1 className="mt-4 text-[28px] font-semibold leading-tight tracking-tight text-white">
          Welcome, {firstName}.
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-300">
          This workspace is yours and it is empty, which is the correct state for an
          account that has not recorded anything yet. Your first meeting will land here.
        </p>
      </div>

      <ol className="mt-8 space-y-3">
        {STEPS.map((step, i) => {
          const done = i === 0
          return (
            <li
              key={step.title}
              className={`surface flex gap-4 rounded-xl border p-4 ${
                done ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-ink-800 bg-ink-900'
              }`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                  done
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-ink-700 bg-ink-850 text-ink-400'
                }`}
              >
                <Icon path={done ? ICONS.check : step.icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink-100">{step.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-400">{step.detail}</p>
              </div>
              <span
                className={`shrink-0 self-center whitespace-nowrap text-[11px] ${
                  done ? 'text-emerald-400' : 'text-ink-500'
                }`}
              >
                {step.status}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="surface mt-8 rounded-xl border border-ink-800 bg-ink-900 p-5">
        <h2 className="text-[14px] font-semibold text-white">
          Want to see it working before your first call?
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-400">
          Load a sample workspace: eight meetings from a fictional company, including an
          eight-person hour-long roadmap review with a real argument in it. It goes into
          your account, and you can clear it whenever you like.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={loadSampleWorkspace}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
          >
            <Icon path={ICONS.sparkle} className="h-3.5 w-3.5" />
            Load the sample workspace
          </button>
          <Link
            to="/share/ck-7f2a91"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
          >
            See a shared clip
            <Icon path={ICONS.arrow} className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <p className="mt-6 text-[12px] leading-relaxed text-ink-500">
        Recording capture is stubbed in this build — playback is simulated over real
        transcript timings rather than audio. Everything after the transcript is real.
      </p>
    </div>
  )
}
