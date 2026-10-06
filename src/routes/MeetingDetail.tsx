import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMeeting, SHARED_CLIPS } from '../data'
import { person } from '../data/people'
import type { Highlight, TemplateId } from '../data/types'
import { Avatar, Icon, ICONS, PlatformTag } from '../components/primitives'
import { Player } from '../components/Player'
import { Transcript } from '../components/Transcript'
import { findActive } from '../lib/transcript'
import { ActionItems, Analytics, Highlights, SummaryPanel } from '../components/Panels'
import { ShareDialog } from '../components/ShareDialog'
import { usePlayback } from '../lib/usePlayback'
import { clipId, useMeetingHighlights, useWorkspace } from '../state/workspace'
import { useSession } from '../state/session'
import { clockTime, durationLabel, longDate, timecode } from '../lib/format'

const TABS = [
  { id: 'summary', label: 'Summary', icon: ICONS.sparkle },
  { id: 'actions', label: 'Actions', icon: ICONS.check },
  { id: 'highlights', label: 'Highlights', icon: ICONS.scissors },
  { id: 'analytics', label: 'Analytics', icon: ICONS.chart },
] as const

type TabId = (typeof TABS)[number]['id']

/** Clip window around the playhead, in seconds before and after. */
const CLIP_LEAD = 20
const CLIP_TAIL = 25

export function MeetingDetail({ id }: { id: string | undefined }) {
  const meeting = getMeeting(id)

  if (!meeting) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-lg font-semibold text-white">Meeting not found</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          It may have been deleted, or the link may be wrong.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-400 hover:underline">
          Back to all meetings
        </Link>
      </div>
    )
  }

  return <MeetingView meeting={meeting} />
}

function MeetingView({ meeting }: { meeting: NonNullable<ReturnType<typeof getMeeting>> }) {
  const [params, setParams] = useSearchParams()
  const { addClip } = useWorkspace()
  const { can } = useSession()

  const [tab, setTab] = useState<TabId>('summary')
  const [template, setTemplate] = useState<TemplateId>(meeting.defaultTemplate)
  const [sharing, setSharing] = useState<Highlight | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const playback = usePlayback(meeting.durationSec)
  const { seek, play, time } = playback
  const highlights = useMeetingHighlights(meeting)

  const startAt = params.get('t')
  useEffect(() => {
    if (startAt === null) return
    const parsed = Number(startAt)
    if (Number.isFinite(parsed)) seek(parsed)
    // Strip the timestamp so a later refresh does not re-seek to a stale position.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('t')
        return next
      },
      { replace: true },
    )
  }, [startAt, seek, setParams])

  const activeIndex = findActive(meeting, time)
  const activeLine = activeIndex >= 0 ? meeting.transcript[activeIndex] : undefined
  const activeSpeaker = activeLine && time - activeLine.t < 25 ? activeLine.speaker : undefined

  const clipHere = () => {
    const start = Math.max(0, Math.floor(time) - CLIP_LEAD)
    const end = Math.min(meeting.durationSec, Math.floor(time) + CLIP_TAIL)
    const spoken = meeting.transcript.filter((l) => l.t >= start && l.t <= end)
    const head = spoken[0]
    const title = head
      ? `${person(head.speaker).name.split(' ')[0]}: “${truncate(head.text, 54)}”`
      : `Clip at ${timecode(start)}`

    addClip({
      id: clipId(meeting.id, start, end),
      meetingId: meeting.id,
      title,
      start,
      end,
      createdBy: 'priya',
      note: 'Clipped during playback.',
    })
    setTab('highlights')
  }

  const existingShare = sharing
    ? SHARED_CLIPS.find((c) => c.meetingId === meeting.id && c.highlightId === sharing.id)
    : undefined

  const openActions = meeting.actionItems.length

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 md:px-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition-colors hover:text-ink-200"
      >
        <Icon path={ICONS.arrow} className="h-3.5 w-3.5 rotate-180" />
        All meetings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white">{meeting.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-400">
            <span>{longDate(meeting.date)}</span>
            <span>·</span>
            <span>{clockTime(meeting.date)}</span>
            <span>·</span>
            <span>{durationLabel(meeting.durationSec)}</span>
            <span>·</span>
            <PlatformTag platform={meeting.platform} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {meeting.participants.map((p) => (
            <Avatar key={p} id={p} size="sm" />
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Player
            meeting={meeting}
            playback={playback}
            highlights={highlights}
            activeSpeaker={activeSpeaker}
            onClip={can('workspace:write') ? clipHere : undefined}
          />

          <div className="flex h-[32rem] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-ink-200">Transcript</h2>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-400">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="h-3 w-3 accent-indigo-500"
                />
                Follow playback
              </label>
            </div>
            <Transcript
              meeting={meeting}
              time={time}
              onSeek={(t) => play(t)}
              autoScroll={autoScroll}
            />
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-ink-800 bg-ink-900">
          <div className="flex gap-0.5 border-b border-ink-800 p-1.5">
            {TABS.map((t) => {
              const count =
                t.id === 'actions' ? openActions : t.id === 'highlights' ? highlights.length : undefined
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id}
                  aria-label={t.label}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-ink-800 text-white'
                      : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
                  }`}
                >
                  <Icon path={t.icon} className="h-3.5 w-3.5 shrink-0" />
                  {/* Four labels do not fit a phone; the icon plus aria-label carries it. */}
                  <span className="hidden truncate sm:inline">{t.label}</span>
                  {count !== undefined && count > 0 && (
                    <span className="rounded bg-ink-700 px-1 text-[10px] tabular-nums text-ink-300">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="max-h-[48rem] overflow-y-auto p-3.5">
            {tab === 'summary' && (
              <SummaryPanel
                meeting={meeting}
                template={template}
                onTemplate={setTemplate}
                onSeek={(t) => play(t)}
              />
            )}
            {tab === 'actions' && <ActionItems meeting={meeting} onSeek={(t) => play(t)} />}
            {tab === 'highlights' && (
              <Highlights
                meeting={meeting}
                highlights={highlights}
                onSeek={(t) => play(t)}
                onShare={setSharing}
              />
            )}
            {tab === 'analytics' && <Analytics meeting={meeting} onSeek={(t) => play(t)} />}
          </div>
        </div>
      </div>

      {sharing && (
        <ShareDialog
          meeting={meeting}
          highlight={sharing}
          clipId={existingShare?.id}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
