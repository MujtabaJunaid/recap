import { Link, useParams } from 'react-router-dom'
import { getMeeting, getSharedClip } from '../data'
import { person } from '../data/people'
import { Avatar, Icon, ICONS } from '../components/primitives'
import { usePlayback } from '../lib/usePlayback'
import { redactLines } from '../lib/redaction'
import { longDate, timecode } from '../lib/format'

export function SharedClipPage() {
  const { clipId } = useParams()
  const clip = getSharedClip(clipId)
  const meeting = getMeeting(clip?.meetingId)
  const highlight = meeting?.highlights.find((h) => h.id === clip?.highlightId)

  const start = highlight?.start ?? 0
  const end = highlight?.end ?? 0
  const { time, playing, toggle, seek } = usePlayback(end, start)

  // Public boundary: the viewer is a stranger holding a URL, so incidental identifiers
  // in the clip's own lines are masked before they reach the DOM.
  const { lines, removed } = redactLines(
    meeting?.transcript.filter((l) => l.t >= start && l.t <= end) ?? [],
  )

  if (!clip || !meeting || !highlight) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-white">This clip is no longer available</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            The link may have expired or the clip was unshared by its owner.
          </p>
        </div>
      </div>
    )
  }

  const duration = end - start
  const elapsed = Math.max(0, Math.min(duration, time - start))
  const activeLine = [...lines].reverse().find((l) => l.t <= time)
  const speakers = [...new Set(lines.map((l) => l.speaker))]

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-ink-800 px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500">
              <Icon path={ICONS.play} className="h-3 w-3 fill-white text-white" />
            </span>
            <span className="text-sm font-semibold text-white">Recap</span>
          </div>
          <span className="text-[12px] text-ink-400">Shared clip · no account needed</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-7 md:px-6">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-400">
          <Avatar id={clip.sharedBy} size="xs" />
          <span className="text-ink-200">{person(clip.sharedBy).name}</span>
          shared {Math.round(duration)} seconds of {meeting.title} with {clip.sharedWith}
        </p>

        {clip.note && (
          <p className="mt-3 border-l-2 border-brand-500 pl-3 text-[14px] leading-relaxed text-ink-200">
            {clip.note}
          </p>
        )}

        <div className="mt-5 overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
          <div className="relative aspect-video bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950">
            <div className="absolute inset-0 grid place-items-center">
              {activeLine ? (
                <div className="flex flex-col items-center gap-2.5 px-8 text-center">
                  <Avatar id={activeLine.speaker} size="lg" />
                  <p className="text-sm font-medium text-white">
                    {person(activeLine.speaker).name}
                  </p>
                  <p className="max-w-lg text-[13px] leading-relaxed text-ink-300">
                    {activeLine.text}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-400">Press play</p>
              )}
            </div>
            <div className="absolute left-3 top-3 rounded-md bg-ink-950/70 px-2 py-1 text-[11px] text-ink-300 backdrop-blur">
              Clip · {timecode(start)}–{timecode(end)} of {meeting.title}
            </div>
          </div>

          <div className="flex items-center gap-3 px-3 py-2.5">
            <button
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600"
            >
              <Icon
                path={playing ? ICONS.pause : ICONS.play}
                className={playing ? 'h-4 w-4' : 'h-4 w-4 translate-x-px fill-current'}
              />
            </button>
            <div
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                seek(start + ((e.clientX - box.left) / box.width) * duration)
              }}
              className="h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-ink-800"
            >
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${(elapsed / duration) * 100}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-400">
              {timecode(elapsed)} / {timecode(duration)}
            </span>
          </div>
        </div>

        <h1 className="mt-5 text-lg font-semibold tracking-tight text-white">{highlight.title}</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          From {meeting.title} · {longDate(meeting.date)} · {speakers.length}{' '}
          {speakers.length === 1 ? 'speaker' : 'speakers'} in this clip
        </p>

        <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900 p-4">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            Clip transcript
          </h2>
          <div className="space-y-2.5">
            {lines.map((l, i) => (
              <button
                key={i}
                onClick={() => seek(l.t)}
                className={`flex w-full gap-2.5 rounded-lg p-1.5 text-left transition-colors ${
                  activeLine === l ? 'bg-brand-500/10' : 'hover:bg-ink-850'
                }`}
              >
                <Avatar id={l.speaker} size="xs" />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-ink-200">
                      {person(l.speaker).name}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-ink-400">
                      {timecode(l.t)}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 block text-[13px] leading-relaxed ${
                      activeLine === l ? 'text-white' : 'text-ink-300'
                    }`}
                  >
                    {l.text}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
          You are seeing only this clip. The rest of the meeting, its summary and its action items
          stay inside {person(clip.sharedBy).org}.
          {removed.length > 0 && (
            <span className="mt-1 block text-ink-300">
              Some details were masked for this public link: {removed.join(', ')}.
            </span>
          )}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900 p-4">
          <div>
            <p className="text-[13px] font-medium text-white">
              Recap records, transcribes and summarises your meetings.
            </p>
            <p className="mt-0.5 text-[12px] text-ink-400">
              Clips like this one take two clicks to make.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
          >
            Explore the workspace
            <Icon path={ICONS.arrow} className="h-3.5 w-3.5" />
          </Link>
        </div>
      </main>
    </div>
  )
}
