import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../state/session'
import { MEETINGS } from '../data'
import { person } from '../data/people'
import { AvatarStack, Icon, ICONS, PlatformTag, Pill } from '../components/primitives'
import { clockTime, durationLabel, relativeDay } from '../lib/format'
import { speakerStats } from '../lib/analytics'

const TEAMS = ['All', 'Product', 'Sales', 'Customer Success', 'Engineering', 'Design', 'Support', 'Leadership']

export function Meetings() {
  const [team, setTeam] = useState('All')
  const [noticeOpen, setNoticeOpen] = useState(true)
  const { email } = useSession()

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

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Meetings</h1>
          <p className="mt-1 text-sm text-ink-400">
            {totals.count} recorded · {totals.hours} hours captured · {totals.open} open action items
          </p>
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
              You are in a shared demo workspace, not an empty new account
            </p>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-400">
              Signing in as{' '}
              <span className="text-ink-300">{email ?? 'a guest'}</span> drops you into
              Northbeam&rsquo;s workspace with eight real meetings already in it, because an
              empty list would show you nothing about what this does. Everything you change
              — completing an action, clipping a moment, choosing a work style — is yours and
              stays in this browser. There is one shared password and one workspace; per-user
              accounts would need a database this build does not have.
            </p>
          </div>
          <button
            onClick={() => setNoticeOpen(false)}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            Got it
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-1.5">
        {TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              team === t
                ? 'bg-brand-500 text-white'
                : 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-200'
            }`}
          >
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
              className={`rise surface rounded-xl border border-ink-800 bg-ink-900 p-4 ${
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
                    <Pill>{meeting.team}</Pill>
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
