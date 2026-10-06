import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getMeeting, SHARED_CLIPS } from '../data'
import { person } from '../data/people'
import type { Highlight, TemplateId } from '../data/types'
import { Avatar, Icon, ICONS, PlatformTag } from '../components/primitives'
import { Player } from '../components/Player'
import { Transcript, findActive } from '../components/Transcript'
import { ActionItems, Analytics, Highlights, SummaryPanel } from '../components/Panels'
import { ShareDialog } from '../components/ShareDialog'
import { usePlayback } from '../lib/usePlayback'
import { clockTime, durationLabel, longDate, timecode } from '../lib/format'

const TABS = [
  { id: 'summary', label: 'Summary', icon: ICONS.sparkle },
  { id: 'actions', label: 'Actions', icon: ICONS.check },
  { id: 'highlights', label: 'Highlights', icon: ICONS.scissors },
  { id: 'analytics', label: 'Analytics', icon: ICONS.chart },
] as const

type TabId = (typeof TABS)[number]['id']

export function MeetingDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const meeting = getMeeting(id)

  const [tab, setTab] = useState<TabId>('summary')
  const [template, setTemplate] = useState<TemplateId>(meeting?.defaultTemplate ?? 'general')
  const [extraHighlights, setExtraHighlights] = useState<Highlight[]>([])
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState<Highlight | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const playback = usePlayback(meeting?.durationSec ?? 0)
  const { seek, play, time } = playback

  const startAt = params.get('t')
  useEffect(() => {
    if (startAt === null) return
    const parsed = Number(startAt)
    if (Number.isFinite(parsed)) seek(parsed)
    const next = new URLSearchParams(params)
    next.delete('t')
    setParams(next, { replace: true })
    // Only runs when a deep link supplies a timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt])

  const highlights = useMemo(
    () =>
      meeting
        ? [...meeting.highlights, ...extraHighlights].sort((a, b) => a.start - b.start)
        : [],
    [meeting, extraHighlights],
  )

  if (!meeting) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-lg font-semibold text-white">Meeting not found</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-400 hover:underline">
          Back to all meetings
        </Link>
      </div>
    )
  }

  const activeIndex = findActive(meeting, time)
  const activeLine = activeIndex >= 0 ? meeting.transcript[activeIndex] : undefined
  const activeSpeaker = activeLine && time - activeLine.t < 25 ? activeLine.speaker : undefined

  const clipHere = () => {
    const start = Math.max(0, Math.floor(time) - 20)
    const end = Math.min(meeting.durationSec, Math.floor(time) + 25)
    const spoken = meeting.transcript.filter((l) => l.t >= start && l.t <= end)
    const title = spoken.length
      ? `${person(spoken[0].speaker).name.split(' ')[0]}: “${spoken[0].text.slice(0, 54)}${spoken[0].text.length > 54 ? '…' : ''}”`
      : `Clip at ${timecode(start)}`
    const highlight: Highlight = {
      id: `local-${Date.now()}`,
      title,
      start,
      end,
      createdBy: 'priya',
      note: 'Clipped during playback.',
    }
    setExtraHighlights((prev) => [...prev, highlight])
    setTab('highlights')
  }

  const toggleAction = (actionId: string) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(actionId)) next.delete(actionId)
      else next.add(actionId)
      return next
    })

  const existingShare = sharing
    ? SHARED_CLIPS.find((c) => c.meetingId === meeting.id && c.highlightId === sharing.id)
    : undefined

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
        <div className="flex items-center gap-1.5">
          {meeting.participants.map((p) => (
            <Avatar key={p} id={p} size="sm" />
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Player
            meeting={meeting}
            playback={playback}
            activeSpeaker={activeSpeaker}
            onClip={clipHere}
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

        <div className="rounded-xl border border-ink-800 bg-ink-900">
          <div className="flex gap-0.5 border-b border-ink-800 p-1.5">
            {TABS.map((t) => {
              const count =
                t.id === 'actions'
                  ? meeting.actionItems.length
                  : t.id === 'highlights'
                    ? highlights.length
                    : undefined
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-ink-800 text-white'
                      : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
                  }`}
                >
                  <Icon path={t.icon} className="h-3.5 w-3.5" />
                  {t.label}
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
            {tab === 'actions' && (
              <ActionItems
                items={meeting.actionItems}
                onSeek={(t) => play(t)}
                completed={toggled}
                onToggle={toggleAction}
              />
            )}
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
