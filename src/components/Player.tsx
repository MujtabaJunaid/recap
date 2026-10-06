import { useMemo, useRef } from 'react'
import type { Meeting } from '../data/types'
import type { Playback } from '../lib/usePlayback'
import { Avatar, Icon, ICONS } from './primitives'
import { person } from '../data/people'
import { timecode } from '../lib/format'
import { speakerTimeline } from '../lib/analytics'

const RATES = [1, 1.25, 1.5, 2]
const BUCKETS = 180

export function Player({
  meeting,
  playback,
  activeSpeaker,
  onClip,
}: {
  meeting: Meeting
  playback: Playback
  activeSpeaker?: string
  onClip: () => void
}) {
  const { time, playing, rate, seek, toggle, skip, setRate } = playback
  const track = useRef<HTMLDivElement>(null)
  const grid = useMemo(() => speakerTimeline(meeting, BUCKETS), [meeting])
  const progress = (time / meeting.durationSec) * 100

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect()
    if (!box) return
    seek(((e.clientX - box.left) / box.width) * meeting.durationSec)
  }

  const activeChapter = meeting.chapters.find((c) => time >= c.start && time < c.end)

  return (
    <div className="overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
      <div className="relative aspect-video bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950">
        <div className="absolute inset-0 grid place-items-center">
          {activeSpeaker ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar id={activeSpeaker} size="lg" />
              <div>
                <p className="text-sm font-medium text-white">{person(activeSpeaker).name}</p>
                <p className="text-xs text-ink-400">{person(activeSpeaker).title}</p>
              </div>
              <div className="flex items-end gap-0.5" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-brand-400/70"
                    style={{
                      height: playing ? `${8 + ((i * 7 + Math.floor(time * 3)) % 16)}px` : '4px',
                      transition: 'height 120ms linear',
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-400">No one speaking</p>
          )}
        </div>

        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-ink-950/70 px-2 py-1 text-[11px] text-ink-300 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Recorded · {meeting.participants.length} participants
        </div>

        {activeChapter && (
          <div className="absolute bottom-3 left-3 right-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-400">Now</p>
            <p className="truncate text-sm font-medium text-white">{activeChapter.title}</p>
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <div className="mb-1.5 flex gap-px overflow-hidden rounded" aria-hidden>
          {meeting.chapters.map((c) => (
            <button
              key={c.id}
              title={c.title}
              onClick={() => seek(c.start)}
              style={{ flexGrow: c.end - c.start }}
              className={`h-1 transition-colors ${
                activeChapter?.id === c.id ? 'bg-brand-500' : 'bg-ink-700 hover:bg-ink-600'
              }`}
            />
          ))}
        </div>

        <div
          ref={track}
          onClick={scrub}
          className="group relative h-10 cursor-pointer select-none rounded-md bg-ink-950/60 px-px py-1"
        >
          <div className="flex h-full flex-col justify-center gap-px">
            {meeting.participants.slice(0, 8).map((p) => (
              <div key={p} className="flex h-[3px] gap-px">
                {grid[p]?.map((v, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-[1px]"
                    style={{
                      background: v > 0 ? 'var(--color-brand-400)' : 'transparent',
                      opacity: v > 0 ? 0.55 + v * 0.45 : 0,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          {meeting.highlights.map((h) => (
            <span
              key={h.id}
              title={h.title}
              className="absolute top-0 h-full bg-amber-400/20 ring-1 ring-inset ring-amber-400/40"
              style={{
                left: `${(h.start / meeting.durationSec) * 100}%`,
                width: `${Math.max(0.4, ((h.end - h.start) / meeting.durationSec) * 100)}%`,
              }}
            />
          ))}

          <span
            className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
            style={{ left: `${progress}%` }}
          >
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white" />
          </span>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600"
          >
            <Icon
              path={playing ? ICONS.pause : ICONS.play}
              className={playing ? 'h-4 w-4' : 'h-4 w-4 translate-x-px fill-current'}
            />
          </button>
          <button
            onClick={() => skip(-15)}
            aria-label="Back 15 seconds"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-ink-800 hover:text-white"
          >
            <Icon path={ICONS.back} />
          </button>
          <button
            onClick={() => skip(30)}
            aria-label="Forward 30 seconds"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-ink-800 hover:text-white"
          >
            <Icon path={ICONS.forward} />
          </button>

          <span className="ml-1 font-mono text-xs tabular-nums text-ink-300">
            {timecode(time)} <span className="text-ink-600">/</span> {timecode(meeting.durationSec)}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={onClip}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:border-brand-500/50 hover:text-white"
            >
              <Icon path={ICONS.scissors} className="h-3.5 w-3.5" />
              Clip this moment
            </button>
            <button
              onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
              className="w-11 rounded-lg border border-ink-700 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
            >
              {rate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
