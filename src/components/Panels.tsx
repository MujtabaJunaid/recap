import { useMemo, useState } from 'react'
import type { ActionItem, Highlight, Meeting, TemplateId } from '../data/types'
import { TEMPLATE_LABELS, TEMPLATES } from '../data'
import { person } from '../data/people'
import { Avatar, EmptyState, Icon, ICONS, Pill } from './primitives'
import { dueLabel, isOverdue, timecode } from '../lib/format'
import { meetingInsights, speakerStats } from '../lib/analytics'
import { useWorkspace } from '../state/workspace'
import { useSession } from '../state/session'

export function SummaryPanel({
  meeting,
  template,
  onTemplate,
  onSeek,
}: {
  meeting: Meeting
  template: TemplateId
  onTemplate: (t: TemplateId) => void
  onSeek: (t: number) => void
}) {
  const summary = meeting.summaries[template]
  const available = TEMPLATES.filter((t) => meeting.summaries[t.id])

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          <Icon path={ICONS.sparkle} className="h-3.5 w-3.5 text-brand-400" />
          Summary template
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => {
            const has = meeting.summaries[t.id] !== undefined
            return (
              <button
                key={t.id}
                disabled={!has}
                onClick={() => onTemplate(t.id)}
                title={has ? undefined : 'Not generated for this meeting'}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  template === t.id
                    ? 'bg-brand-500 text-white'
                    : has
                      ? 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white'
                      : 'cursor-not-allowed bg-ink-850 text-ink-600'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        {available.length < TEMPLATES.length && (
          <p className="mt-2 text-[11px] text-ink-400">
            {available.length} of {TEMPLATES.length} templates generated. Greyed-out templates
            re-run the summariser over the same transcript.
          </p>
        )}
      </div>

      {summary ? (
        <div className="rise space-y-4" key={template}>
          <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 p-3.5">
            <p className="text-[13px] leading-relaxed text-ink-200">{summary.headline}</p>
          </div>

          {summary.sections.map((section) => (
            <div key={section.heading}>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                {section.heading}
              </h3>
              <ul className="space-y-1.5">
                {section.bullets.map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-300">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-600" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={`No ${TEMPLATE_LABELS[template]} summary yet`}
          detail="Pick a generated template, or re-run the summariser for this one."
        />
      )}

      {meeting.chapters.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            Chapters
          </h3>
          <div className="space-y-1">
            {meeting.chapters.map((c) => (
              <button
                key={c.id}
                onClick={() => onSeek(c.start)}
                className="group flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-850"
              >
                <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-400 group-hover:text-brand-400">
                  {timecode(c.start)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink-200">{c.title}</span>
                  <span className="block text-[12px] leading-snug text-ink-400">{c.gist}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ActionItems({
  meeting,
  onSeek,
}: {
  meeting: Meeting
  onSeek: (t: number) => void
}) {
  const { isActionDone, setActionDone } = useWorkspace()
  const { can } = useSession()

  if (meeting.actionItems.length === 0) {
    return <EmptyState title="No action items" detail="Nothing in this call was committed to." />
  }

  const done = (item: ActionItem) => isActionDone(meeting, item.id)
  const open = meeting.actionItems.filter((i) => !done(i))
  const complete = meeting.actionItems.filter(done)

  const toggle = (item: ActionItem) => setActionDone(meeting.id, item.id, !done(item))

  return (
    <div className="space-y-4">
      <Group
        title={`Open (${open.length})`}
        items={open}
        onSeek={onSeek}
        onToggle={toggle}
        done={false}
        editable={can('workspace:write')}
      />
      {complete.length > 0 && (
        <Group
          title={`Done (${complete.length})`}
          items={complete}
          onSeek={onSeek}
          onToggle={toggle}
          done
          editable={can('workspace:write')}
        />
      )}
    </div>
  )
}

function Group({
  title,
  items,
  onSeek,
  onToggle,
  done,
  editable,
}: {
  title: string
  items: ActionItem[]
  onSeek: (t: number) => void
  onToggle: (item: ActionItem) => void
  done: boolean
  editable: boolean
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
        {title}
      </h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex gap-2.5 rounded-lg border border-ink-800 bg-ink-900 p-2.5 ${
              done ? 'opacity-55' : ''
            }`}
          >
            <button
              onClick={() => onToggle(item)}
              disabled={!editable}
              aria-pressed={done}
              aria-label={done ? `Reopen: ${item.text}` : `Complete: ${item.text}`}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                done
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-ink-600 enabled:hover:border-brand-500'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {done && <Icon path={ICONS.check} className="h-2.5 w-2.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-relaxed ${done ? 'text-ink-400 line-through' : 'text-ink-200'}`}>
                {item.text}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {item.owner ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
                    <Avatar id={item.owner} size="xs" />
                    {person(item.owner).name}
                  </span>
                ) : (
                  <Pill tone="warn">Unassigned</Pill>
                )}
                {item.due && !done && (
                  <Pill tone={isOverdue(item.due) ? 'warn' : 'default'}>{dueLabel(item.due)}</Pill>
                )}
                <button
                  onClick={() => onSeek(item.t)}
                  className="font-mono text-[11px] tabular-nums text-ink-400 transition-colors hover:text-brand-400"
                >
                  {timecode(item.t)}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Highlights({
  meeting,
  highlights,
  onSeek,
  onShare,
}: {
  meeting: Meeting
  highlights: Highlight[]
  onSeek: (t: number) => void
  onShare: (h: Highlight) => void
}) {
  if (highlights.length === 0) {
    return (
      <EmptyState
        title="No highlights yet"
        detail="Hit “Clip this moment” during or after a call to pull out a shareable moment."
      />
    )
  }

  return (
    <div className="space-y-2">
      {highlights.map((h) => {
        const lines = meeting.transcript.filter((l) => l.t >= h.start && l.t <= h.end)
        return (
          <div key={h.id} className="rise rounded-lg border border-ink-800 bg-ink-900 p-3">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onSeek(h.start)} className="min-w-0 text-left">
                <p className="text-[13px] font-medium text-ink-100 hover:text-white">{h.title}</p>
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-400">
                  {timecode(h.start)} – {timecode(h.end)} · {Math.round(h.end - h.start)}s
                </p>
              </button>
              <button
                onClick={() => onShare(h)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition-colors hover:border-brand-500/50 hover:text-white"
              >
                <Icon path={ICONS.link} className="h-3 w-3" />
                Share
              </button>
            </div>

            {lines.length > 0 && (
              <div className="mt-2 space-y-1 border-l-2 border-ink-700 pl-2.5">
                {lines.slice(0, 3).map((l, i) => (
                  <p key={i} className="text-[12px] leading-snug text-ink-400">
                    <span className="font-medium text-ink-300">
                      {person(l.speaker).name.split(' ')[0]}:
                    </span>{' '}
                    {l.text}
                  </p>
                ))}
                {lines.length > 3 && (
                  <p className="text-[11px] text-ink-600">+{lines.length - 3} more lines</p>
                )}
              </div>
            )}

            {h.note && (
              <p className="mt-2 flex gap-1.5 text-[12px] italic text-ink-400">
                <Avatar id={h.createdBy} size="xs" />
                {h.note}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Analytics({ meeting, onSeek }: { meeting: Meeting; onSeek: (t: number) => void }) {
  const stats = useMemo(() => speakerStats(meeting), [meeting])
  const insights = useMemo(() => meetingInsights(meeting), [meeting])
  const max = stats[0]?.share || 1
  const [sort, setSort] = useState<'time' | 'turns'>('time')
  const longestChapter = useMemo(
    () => Math.max(1, ...meeting.chapters.map((c) => c.end - c.start)),
    [meeting],
  )
  const ordered =
    sort === 'time' ? stats : [...stats].sort((a, b) => b.turns - a.turns)

  return (
    <div className="space-y-4">
      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {insights.map((i) => (
            <div
              key={i.label}
              className={`min-w-[8rem] flex-1 rounded-lg border p-2.5 ${
                i.tone === 'warn'
                  ? 'border-amber-500/25 bg-amber-500/5'
                  : 'border-ink-800 bg-ink-900'
              }`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                {i.label}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-200">{i.detail}</p>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            Talk time
          </h3>
          <div className="flex gap-1">
            {(['time', 'turns'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  sort === s ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                {s === 'time' ? 'By time' : 'By turns'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {ordered.map((s) => (
            <div key={s.speaker} className="flex items-center gap-2.5">
              <Avatar id={s.speaker} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-ink-200">
                    {person(s.speaker).name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-400">
                    {Math.round(s.share * 100)}% · {s.turns} turns
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className={`h-full rounded-full ${
                      s.seconds === 0 ? 'bg-ink-700' : 'bg-brand-500'
                    }`}
                    style={{ width: `${Math.max(1, (s.share / max) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-snug text-ink-400">
          Talk time is estimated from transcript word counts, clamped to the gap before the next
          line. It is a speaking-share signal, not diarisation output.
        </p>
      </div>

      {meeting.chapters.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            Time per chapter
          </h3>
          <div className="space-y-1.5">
            {meeting.chapters.map((c) => (
              <button
                key={c.id}
                onClick={() => onSeek(c.start)}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <span className="w-28 shrink-0 truncate text-[12px] text-ink-300">{c.title}</span>
                <span className="h-4 flex-1 overflow-hidden rounded bg-ink-800">
                  <span
                    className="block h-full rounded bg-ink-600"
                    style={{ width: `${((c.end - c.start) / longestChapter) * 100}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-400">
                  {Math.round((c.end - c.start) / 60)}m
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
