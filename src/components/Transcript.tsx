import { useEffect, useRef, useState } from 'react'
import type { Meeting } from '../data/types'
import { person } from '../data/people'
import { Avatar, Icon, ICONS } from './primitives'
import { timecode } from '../lib/format'
import { segments } from '../lib/search'
import { findActive } from '../lib/transcript'

export function Transcript({
  meeting,
  time,
  onSeek,
  autoScroll,
}: {
  meeting: Meeting
  time: number
  onSeek: (t: number) => void
  autoScroll: boolean
}) {
  const [filter, setFilter] = useState('')
  const [speaker, setSpeaker] = useState('all')
  const activeRef = useRef<HTMLButtonElement>(null)

  const activeIndex = findActive(meeting, time)

  useEffect(() => {
    if (!autoScroll || filter) return
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex, autoScroll, filter])

  const query = filter.trim()
  const lines = meeting.transcript
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => speaker === 'all' || line.speaker === speaker)
    .filter(({ line }) => !query || line.text.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-2">
        <div className="relative flex-1">
          <Icon
            path={ICONS.search}
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find in transcript"
            className="w-full rounded-md border border-ink-700 bg-ink-950 py-1.5 pl-8 pr-2 text-[13px] text-ink-200 outline-none placeholder:text-ink-400 focus:border-brand-500/60"
          />
        </div>
        <select
          value={speaker}
          onChange={(e) => setSpeaker(e.target.value)}
          className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-[13px] text-ink-200 outline-none focus:border-brand-500/60"
        >
          <option value="all">Everyone</option>
          {meeting.participants.map((p) => (
            <option key={p} value={p}>
              {person(p).name}
            </option>
          ))}
        </select>
      </div>

      {query && (
        <p className="border-b border-ink-800 px-3 py-1.5 text-[11px] text-ink-400">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} matching “{query}”
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {lines.map(({ line, index }, row) => {
          // Group against the previous *visible* line, so filtering never hides a name.
          const previous = lines[row - 1]
          const newSpeaker = !previous || previous.line.speaker !== line.speaker
          const isActive = index === activeIndex
          return (
            <button
              key={index}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(line.t)}
              className={`group flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isActive ? 'bg-brand-500/10' : 'hover:bg-ink-850'
              }`}
            >
              <span className="w-7 shrink-0 pt-0.5">
                {newSpeaker ? <Avatar id={line.speaker} size="xs" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                {newSpeaker && (
                  <span className="mb-0.5 flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-ink-200">
                      {person(line.speaker).name}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-ink-400 group-hover:text-brand-400">
                      {timecode(line.t)}
                    </span>
                  </span>
                )}
                <span
                  className={`block text-[13px] leading-relaxed ${
                    isActive ? 'text-white' : 'text-ink-300'
                  }`}
                >
                  {query
                    ? segments(line.text, query).map((s, i) =>
                        s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
                      )
                    : line.text}
                </span>
              </span>
            </button>
          )
        })}
        {lines.length === 0 && (
          <p className="px-3 py-8 text-center text-[13px] text-ink-400">
            Nothing in this transcript matches that.
          </p>
        )}
      </div>
    </div>
  )
}
