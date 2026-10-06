import { useEffect, useState } from 'react'
import type { Highlight, Meeting } from '../data/types'
import { Icon, ICONS } from './primitives'
import { person } from '../data/people'
import { timecode } from '../lib/format'

export function ShareDialog({
  meeting,
  highlight,
  clipId,
  onClose,
}: {
  meeting: Meeting
  highlight: Highlight
  clipId?: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [includeContext, setIncludeContext] = useState(true)

  const id = clipId ?? `ck-${highlight.id.slice(-6)}`
  const url = `${window.location.origin}${import.meta.env.BASE_URL}share/${id}`
  const shareable = Boolean(clipId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard can be blocked by permissions; the link stays selectable either way.
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const lines = meeting.transcript.filter((l) => l.t >= highlight.start && l.t <= highlight.end)

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rise w-full max-w-lg overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Share this clip</h2>
            <p className="mt-0.5 truncate text-[12px] text-ink-400">
              {meeting.title} · {timecode(highlight.start)}–{timecode(highlight.end)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-white"
          >
            <Icon path="M6 6l12 12M18 6L6 18" />
          </button>
        </div>

        <div className="space-y-3.5 p-4">
          <div className="rounded-lg border border-ink-800 bg-ink-950 p-3">
            <p className="text-[13px] font-medium text-ink-100">{highlight.title}</p>
            <div className="mt-2 space-y-1 border-l-2 border-brand-500/40 pl-2.5">
              {lines.slice(0, 2).map((l, i) => (
                <p key={i} className="text-[12px] leading-snug text-ink-400">
                  <span className="font-medium text-ink-300">
                    {person(l.speaker).name.split(' ')[0]}:
                  </span>{' '}
                  {l.text}
                </p>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-800 p-2.5">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
            />
            <span>
              <span className="block text-[13px] text-ink-200">Include surrounding context</span>
              <span className="block text-[12px] text-ink-400">
                Viewers see the full transcript of the clip, not just the headline moment.
              </span>
            </span>
          </label>

          {shareable ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2 font-mono text-[12px] text-ink-300 outline-none"
                />
                <button
                  onClick={copy}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
                >
                  <Icon path={copied ? ICONS.check : ICONS.link} className="h-3.5 w-3.5" />
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="text-[12px] text-ink-400">
                Anyone with this link can watch the clip without signing in. They see only the clip
                {includeContext ? ' and its transcript' : ''} — never the rest of the meeting.
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-3 text-[12px] leading-relaxed text-ink-400">
              This clip was created in your browser during this session, so it has no public URL in
              this build. The three seeded clips have live share pages — try sharing a highlight on
              the Q3 Roadmap Review, Northwind renewal, or latency escalation.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
