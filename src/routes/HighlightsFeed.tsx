import { Link } from 'react-router-dom'
import { MEETINGS, SHARED_CLIPS } from '../data'
import { person } from '../data/people'
import { Avatar, Icon, ICONS, Pill } from '../components/primitives'
import { relativeDay, timecode } from '../lib/format'

export function HighlightsFeed() {
  const rows = MEETINGS.flatMap((meeting) =>
    meeting.highlights.map((highlight) => ({
      meeting,
      highlight,
      shared: SHARED_CLIPS.find(
        (c) => c.meetingId === meeting.id && c.highlightId === highlight.id,
      ),
    })),
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 md:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Highlights</h1>
      <p className="mt-1 text-sm text-ink-400">
        {rows.length} clipped moments. {SHARED_CLIPS.length} have been shared outside the
        workspace and open without a login.
      </p>

      <div className="mt-5 space-y-2.5">
        {rows.map(({ meeting, highlight, shared }) => {
          const lines = meeting.transcript.filter(
            (l) => l.t >= highlight.start && l.t <= highlight.end,
          )
          return (
            <article
              key={`${meeting.id}-${highlight.id}`}
              className="rise rounded-xl border border-ink-800 bg-ink-900 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/m/${meeting.id}?t=${highlight.start}`}
                    className="text-[14px] font-semibold text-white hover:underline"
                  >
                    {highlight.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-400">
                    <span>{meeting.title}</span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {timecode(highlight.start)}–{timecode(highlight.end)}
                    </span>
                    <span>·</span>
                    <span>{relativeDay(meeting.date)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {shared && <Pill tone="good">Shared</Pill>}
                  <Link
                    to={shared ? `/share/${shared.id}` : `/m/${meeting.id}?t=${highlight.start}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-200 transition-colors hover:border-brand-500/50 hover:text-white"
                  >
                    <Icon path={shared ? ICONS.link : ICONS.play} className="h-3 w-3" />
                    {shared ? 'Open share page' : 'Play'}
                  </Link>
                </div>
              </div>

              <div className="mt-3 space-y-1 border-l-2 border-ink-700 pl-3">
                {lines.slice(0, 3).map((l, i) => (
                  <p key={i} className="text-[12px] leading-relaxed text-ink-400">
                    <span className="font-medium text-ink-300">{person(l.speaker).name}:</span>{' '}
                    {l.text}
                  </p>
                ))}
              </div>

              {shared && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-850 p-2.5 text-[12px] text-ink-400">
                  <Avatar id={shared.sharedBy} size="xs" />
                  <span>
                    <span className="text-ink-300">{person(shared.sharedBy).name}</span> shared this
                    with {shared.sharedWith}
                    {shared.note && <span className="block italic">“{shared.note}”</span>}
                  </span>
                </p>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
