import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon, ICONS, Pill } from '../components/primitives'
import { useSession } from '../state/session'
import { getSavedMeeting, type SavedMeetingDetail } from '../lib/meetingsClient'
import { buildActionPlan, type WorkStyleId } from '../lib/coaching'
import { useWorkspace } from '../state/workspace'
import { timecode } from '../lib/format'

/** A call Recap sat in, with the summary a model wrote from its transcript. */
export function SavedMeeting() {
  const { id } = useParams()
  const { token } = useSession()
  const { workStyle } = useWorkspace()
  const [meeting, setMeeting] = useState<SavedMeetingDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !id) return
    let cancelled = false

    const load = async () => {
      try {
        const next = await getSavedMeeting(token, id)
        if (cancelled) return
        setMeeting(next)
        return next.status
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load that call.')
        return 'failed'
      }
    }

    void load().then((status) => {
      // Summarisation runs after the call is stored, so poll until it lands.
      if (status !== 'processing' || cancelled) return
      const poll = setInterval(async () => {
        const next = await load()
        if (next !== 'processing') clearInterval(poll)
      }, 3000)
      return () => clearInterval(poll)
    })

    return () => {
      cancelled = true
    }
  }, [token, id])

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-lg font-semibold text-white">{error}</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-400 hover:underline">
          Back to meetings
        </Link>
      </div>
    )
  }

  if (!meeting) {
    return <p className="mx-auto max-w-xl px-6 py-20 text-center text-sm text-ink-400">Loading…</p>
  }

  const summary = meeting.summary

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 md:px-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition-colors hover:text-ink-200"
      >
        <Icon path={ICONS.arrow} className="h-3.5 w-3.5 rotate-180" />
        All meetings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white">{meeting.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-400">
            <span>{new Date(meeting.created_at).toLocaleString()}</span>
            <span>·</span>
            <span>{Math.round(meeting.duration_s)}s</span>
            <span>·</span>
            <span className="uppercase">{meeting.platform}</span>
            <span>·</span>
            <span>{meeting.participants.length} participants</span>
          </p>
        </div>
        <Pill tone={meeting.source === 'simulated' ? 'warn' : 'good'}>
          {meeting.source === 'simulated' ? 'Simulated capture' : 'Recorded audio'}
        </Pill>
      </div>

      {meeting.status === 'processing' && (
        <div className="surface mt-5 flex items-center gap-2.5 rounded-xl border border-ink-800 bg-ink-900 p-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
          </span>
          <p className="text-[13px] text-ink-300">
            Summarising the transcript — this page updates when it is done.
          </p>
        </div>
      )}

      {meeting.status === 'failed' && (
        <p className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 text-[13px] text-rose-200">
          The summary could not be generated. The transcript below is intact.
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {summary && (
            <>
              <section className="surface rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                  Summary
                </h2>
                <p className="text-[13px] leading-relaxed text-ink-200">{summary.headline}</p>
              </section>

              {summary.decisions.length > 0 && (
                <section className="surface rounded-xl border border-ink-800 bg-ink-900 p-4">
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Decisions
                  </h2>
                  <ul className="space-y-1.5">
                    {summary.decisions.map((d, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-300">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {summary.openQuestions.length > 0 && (
                <section className="surface rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                    Left unresolved
                  </h2>
                  <ul className="space-y-1.5">
                    {summary.openQuestions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-300">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                        {q}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {summary && summary.actionItems.length > 0 && (
            <section className="surface rounded-xl border border-ink-800 bg-ink-900 p-4">
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Action items
              </h2>
              <div className="space-y-2.5">
                {summary.actionItems.map((item) => (
                  <SavedActionRow key={item.id} item={item} style={workStyle} title={meeting.title} />
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="surface flex h-[34rem] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
          <h2 className="border-b border-ink-800 px-4 py-2.5 text-[13px] font-semibold text-ink-200">
            Transcript · {meeting.transcript.length} lines
          </h2>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {meeting.transcript.map((line, i) => (
              <div key={i}>
                <p className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-ink-200">{line.speaker}</span>
                  <span className="font-mono text-[10px] tabular-nums text-ink-500">
                    {timecode(line.t)}
                  </span>
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-300">{line.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * Action items from a saved call get the same work-style plan as seeded ones, generated
 * locally since the item already exists and the shape is the same.
 */
function SavedActionRow({
  item,
  style,
  title,
}: {
  item: { id: string; text: string; owner: string | null; t: number }
  style: WorkStyleId
  title: string
}) {
  const [open, setOpen] = useState(false)
  const plan = buildActionPlan(
    { id: item.id, text: item.text, owner: null, t: item.t },
    {
      id: 'saved',
      title,
      date: new Date().toISOString(),
      durationSec: 0,
      platform: 'zoom',
      host: '',
      participants: [],
      team: '',
      status: 'ready',
      defaultTemplate: 'general',
      summaries: {},
      chapters: [],
      actionItems: [],
      highlights: [],
      transcript: [],
    },
    style,
  )

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      <p className="text-[13px] leading-relaxed text-ink-200">{item.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {item.owner ? (
          <Pill tone="brand">{item.owner}</Pill>
        ) : (
          <Pill tone="warn">Unassigned</Pill>
        )}
        <span className="font-mono text-[11px] tabular-nums text-ink-500">{timecode(item.t)}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand-400 transition-colors hover:bg-brand-500/10"
        >
          <Icon path={ICONS.sparkle} className="h-3 w-3" />
          {open ? 'Hide plan' : 'How to start this'}
        </button>
      </div>

      {open && (
        <div className="rise mt-2.5 rounded-lg border border-brand-500/20 bg-brand-500/5 p-3">
          <p className="text-[13px] font-medium text-white">{plan.cta}</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
            Start here
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-200">{plan.firstStep}</p>
          <ol className="mt-2 space-y-1">
            {plan.steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-300">
                <span className="font-mono text-[10px] text-ink-500">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-ink-400">
            <span className="text-ink-300">Stuck:</span> {plan.ifStuck}
          </p>
        </div>
      )}
    </div>
  )
}
