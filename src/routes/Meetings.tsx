import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../state/session'
import { useWorkspace } from '../state/workspace'
import { EmptyWorkspace } from './EmptyWorkspace'
import { SavedCalls } from '../components/SavedCalls'
import { MEETINGS } from '../data'
import { person } from '../data/people'
import { AvatarStack, Icon, ICONS, PlatformTag, Pill } from '../components/primitives'
import { clockTime, durationLabel, relativeDay } from '../lib/format'
import { speakerStats } from '../lib/analytics'

const TEAMS = ['All', 'Product', 'Sales', 'Customer Success', 'Engineering', 'Design', 'Support', 'Leadership']

/** One hue per team, matched to the tokens in index.css. */
const TEAM_ACCENT: Record<string, string> = {
  Product: 'var(--color-team-product)',
  Sales: 'var(--color-team-sales)',
  'Customer Success': 'var(--color-team-success)',
  Engineering: 'var(--color-team-engineering)',
  Design: 'var(--color-team-design)',
  Support: 'var(--color-team-support)',
  Leadership: 'var(--color-team-leadership)',
}

export function Meetings() {
  const [team, setTeam] = useState('All')
  const [noticeOpen, setNoticeOpen] = useState(true)
  const { email } = useSession()
  const { hasMeetings, clearWorkspace } = useWorkspace()

  const visible = useMemo(
    () => (team === 'All' ? MEETINGS : MEETINGS.filter((m) => m.team === team)),
    [team],
  )

  const totals = useMemo(() => {
    const ready = MEETINGS.filter((m) => m.status === 'ready')
    const seconds = ready.reduce((a, m) => a + m.durationSec, 0)
    const open = ready.flatMap((m) => m.actionItems).filter((a) => !a.done).length
    return { count: ready.length, hours: Math.round(seconds / 360) / 10, open }
  }, [])

  // A new account has recorded nothing. Showing someone else's meetings there would be
  // both confusing and untrue. Calls it actually sat in are shown either way.
  if (!hasMeetings) {
    return (
      <>
        <SavedCalls />
        <EmptyWorkspace />
      </>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] font-semibold leading-tight tracking-tight">
            Meetings
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {[
              { value: totals.count, label: 'recorded' },
              { value: `${totals.hours}h`, label: 'captured' },
              { value: totals.open, label: 'open actions' },
            ].map((stat) => (
              <span key={stat.label} className="flex items-baseline gap-1.5">
                <span className="font-mono text-[17px] tabular-nums text-white">{stat.value}</span>
                <span className="text-[12px] text-ink-400">{stat.label}</span>
              </span>
            ))}
          </div>
        </div>
        <Link
          to="/actions"
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
        >
          <Icon path={ICONS.check} className="h-4 w-4" />
          Review action items
        </Link>
      </div>

      {noticeOpen && (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3.5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink-100">
              This is the sample workspace, loaded into your account
            </p>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-400">
              Eight meetings from a fictional company, so{' '}
              <span className="text-ink-300">{email ?? 'you'}</span> can see what this does
              without waiting for a real call. Everything you change
              — completing an action, clipping a moment, choosing a work style — is saved to
              your account and nobody else&rsquo;s.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={clearWorkspace}
              className="rounded-md px-2 py-1 text-[11px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              Clear it
            </button>
            <button
              onClick={() => setNoticeOpen(false)}
              className="rounded-md px-2 py-1 text-[11px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <SavedCalls inline />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              team === t
                ? 'glow bg-brand-500 text-white'
                : 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-200'
            }`}
          >
            {t !== 'All' && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: TEAM_ACCENT[t] ?? 'var(--color-ink-600)' }}
              />
            )}
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-2.5">
        {visible.map((meeting) => {
          const processing = meeting.status === 'processing'
          const summary = meeting.summaries[meeting.defaultTemplate]
          const openActions = meeting.actionItems.filter((a) => !a.done).length
          const top = speakerStats(meeting)[0]

          const card = (
            <article
              style={{ ['--accent' as string]: TEAM_ACCENT[meeting.team] ?? 'var(--color-ink-700)' }}
              className={`rise surface accent-edge rounded-xl border border-ink-800 bg-ink-900 p-4 pl-5 ${
                processing ? 'opacity-70' : 'surface-hover hover:border-ink-600 hover:bg-ink-850'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-400">
                    <span className="font-medium text-ink-300">{relativeDay(meeting.date)}</span>
                    <span>{clockTime(meeting.date)}</span>
                    <span>·</span>
                    <span>{durationLabel(meeting.durationSec)}</span>
                    <span>·</span>
                    <PlatformTag platform={meeting.platform} />
                  </div>
                  <h2 className="mt-1.5 truncate text-[15px] font-semibold text-white">
                    {meeting.title}
                  </h2>
                </div>
                <AvatarStack ids={meeting.participants} />
              </div>

              {processing ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-ink-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
                  </span>
                  Transcribing and summarising — usually ready within a few minutes of the call ending.
                </div>
              ) : (
                <>
                  <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-ink-300">
                    {summary?.headline}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {openActions > 0 && (
                      <Pill tone="brand">
                        <Icon path={ICONS.check} className="h-3 w-3" />
                        {openActions} open {openActions === 1 ? 'action' : 'actions'}
                      </Pill>
                    )}
                    {meeting.highlights.length > 0 && (
                      <Pill>
                        <Icon path={ICONS.scissors} className="h-3 w-3" />
                        {meeting.highlights.length}{' '}
                        {meeting.highlights.length === 1 ? 'highlight' : 'highlights'}
                      </Pill>
                    )}
                    {meeting.participants.length > 2 && top && top.share > 0.35 && (
                      <Pill tone="warn">
                        {person(top.speaker).name.split(' ')[0]} spoke{' '}
                        {Math.round(top.share * 100)}%
                      </Pill>
                    )}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        color: TEAM_ACCENT[meeting.team] ?? 'var(--color-ink-300)',
                        background: 'color-mix(in srgb, currentColor 12%, transparent)',
                      }}
                    >
                      {meeting.team}
                    </span>
                  </div>
                </>
              )}
            </article>
          )

          return processing ? (
            <div key={meeting.id}>{card}</div>
          ) : (
            <Link key={meeting.id} to={`/m/${meeting.id}`} className="block">
              {card}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
