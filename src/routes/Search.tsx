import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { search, segments, type ResultKind } from '../lib/search'
import { person } from '../data/people'
import { Avatar, Icon, ICONS, Pill } from '../components/primitives'
import { relativeDay, timecode } from '../lib/format'

const KIND_LABEL: Record<ResultKind, string> = {
  transcript: 'Transcript',
  summary: 'Summary',
  action: 'Action item',
  highlight: 'Highlight',
}

const SUGGESTIONS = ['SCIM', 'ingestion rewrite', 'Northwind', 'backfill', 'day two', 'p99']

export function Search() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''
  const groups = useMemo(() => search(query), [query])
  const total = groups.reduce((a, g) => a + g.hits.length, 0)

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-white">
        {total} {total === 1 ? 'result' : 'results'} for “{query}”
      </h1>
      <p className="mt-1 text-sm text-ink-400">
        Across transcripts, summaries, action items and highlights in every recorded meeting.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-ink-400">Try:</span>
        {SUGGESTIONS.map((s) => (
          <Link
            key={s}
            to={`/search?q=${encodeURIComponent(s)}`}
            className="rounded-full bg-ink-850 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-white"
          >
            {s}
          </Link>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
          <p className="text-sm text-ink-200">Nothing matched that.</p>
          <p className="mt-1 text-xs text-ink-400">
            Search runs over every word spoken, not just titles — try a phrase someone would
            actually have said.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {groups.map(({ meeting, hits }) => (
            <section key={meeting.id} className="rise rounded-xl border border-ink-800 bg-ink-900">
              <div className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-2.5">
                <Link to={`/m/${meeting.id}`} className="min-w-0">
                  <h2 className="truncate text-[14px] font-semibold text-white hover:underline">
                    {meeting.title}
                  </h2>
                  <p className="text-[12px] text-ink-400">
                    {relativeDay(meeting.date)} · {meeting.team} · {hits.length}{' '}
                    {hits.length === 1 ? 'match' : 'matches'}
                  </p>
                </Link>
                <Link
                  to={`/m/${meeting.id}`}
                  className="shrink-0 text-[12px] text-brand-400 hover:underline"
                >
                  Open
                </Link>
              </div>

              <div className="divide-y divide-ink-850">
                {hits.slice(0, 6).map((hit, i) => {
                  const to =
                    hit.t !== undefined
                      ? `/m/${meeting.id}?t=${Math.max(0, Math.floor(hit.t) - 3)}`
                      : `/m/${meeting.id}`
                  return (
                    <Link
                      key={i}
                      to={to}
                      className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-ink-850"
                    >
                      <span className="w-14 shrink-0 pt-0.5">
                        {hit.t !== undefined ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-brand-400">
                            <Icon path={ICONS.play} className="h-2.5 w-2.5 fill-current" />
                            {timecode(hit.t)}
                          </span>
                        ) : (
                          <Pill>{KIND_LABEL[hit.kind]}</Pill>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mb-0.5 flex items-center gap-1.5">
                          {hit.speaker && <Avatar id={hit.speaker} size="xs" />}
                          <span className="text-[11px] font-medium text-ink-400">
                            {hit.speaker ? person(hit.speaker).name : KIND_LABEL[hit.kind]}
                            {hit.speaker && <span className="ml-1.5 text-ink-600">{KIND_LABEL[hit.kind]}</span>}
                          </span>
                        </span>
                        <span className="block text-[13px] leading-relaxed text-ink-300">
                          {segments(hit.text, query).map((s, j) =>
                            s.hit ? <mark key={j}>{s.text}</mark> : <span key={j}>{s.text}</span>,
                          )}
                        </span>
                      </span>
                    </Link>
                  )
                })}
                {hits.length > 6 && (
                  <Link
                    to={`/m/${meeting.id}`}
                    className="block px-4 py-2 text-[12px] text-ink-400 transition-colors hover:text-brand-400"
                  >
                    +{hits.length - 6} more in this meeting
                  </Link>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
