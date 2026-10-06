import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, ICONS, Pill } from './primitives'
import { useSession } from '../state/session'
import {
  deleteSavedMeeting,
  listSavedMeetings,
  savedMeetingsEnabled,
  type SavedMeetingSummary,
} from '../lib/meetingsClient'

/**
 * Calls Recap actually sat in, as opposed to the sample library.
 *
 * Shown above the samples and visually distinct, because the difference matters: these
 * are the user's own, summarised by a model from a transcript, and the samples are
 * fixture content.
 */
export function SavedCalls({ inline = false }: { inline?: boolean }) {
  const { token } = useSession()
  const [calls, setCalls] = useState<SavedMeetingSummary[]>([])

  const refresh = useCallback(async () => {
    if (!token || !savedMeetingsEnabled) return
    try {
      setCalls(await listSavedMeetings(token))
    } catch {
      // Not worth an error banner on a dashboard; the next poll retries.
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll only while a summary is still being written, then stop.
  useEffect(() => {
    if (!calls.some((c) => c.status === 'processing')) return
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [calls, refresh])

  if (calls.length === 0) return null

  const remove = async (id: string) => {
    if (!token) return
    await deleteSavedMeeting(token, id).catch(() => {})
    void refresh()
  }

  return (
    <section className={inline ? 'mt-6' : 'mx-auto max-w-5xl px-4 pt-7 md:px-6'}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-brand-400">
          Your calls
        </h2>
        <Link to="/join" className="text-[12px] text-ink-400 transition-colors hover:text-brand-400">
          Join another
        </Link>
      </div>

      <div className="mt-2.5 space-y-2.5">
        {calls.map((call) => {
          const processing = call.status === 'processing'
          return (
            <article
              key={call.id}
              className="surface surface-hover rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-400">
                    <span className="font-medium text-ink-300">
                      {new Date(call.created_at).toLocaleString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>·</span>
                    <span>{Math.round(call.duration_s)}s</span>
                    <span>·</span>
                    <span className="uppercase">{call.platform}</span>
                  </div>
                  <Link
                    to={`/call/${call.id}`}
                    className="mt-1.5 block truncate text-[15px] font-semibold text-white hover:underline"
                  >
                    {call.title}
                  </Link>
                </div>
                <button
                  onClick={() => void remove(call.id)}
                  aria-label={`Delete ${call.title}`}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-500 transition-colors hover:bg-ink-800 hover:text-rose-400"
                >
                  Delete
                </button>
              </div>

              {processing ? (
                <p className="mt-2.5 flex items-center gap-2 text-[13px] text-ink-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
                  </span>
                  Summarising the transcript…
                </p>
              ) : call.summary ? (
                <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-ink-300">
                  {call.summary.headline}
                </p>
              ) : (
                <p className="mt-2.5 text-[13px] text-rose-300">
                  The summary failed, but the transcript is intact.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {call.summary && call.summary.actionItems.length > 0 && (
                  <Pill tone="brand">
                    <Icon path={ICONS.check} className="h-3 w-3" />
                    {call.summary.actionItems.length} action
                    {call.summary.actionItems.length === 1 ? '' : 's'}
                  </Pill>
                )}
                {call.summary && call.summary.openQuestions.length > 0 && (
                  <Pill tone="warn">{call.summary.openQuestions.length} unresolved</Pill>
                )}
                <Pill>{call.lines} lines</Pill>
                <Pill tone={call.source === 'recorded' ? 'good' : 'default'}>
                  {call.source === 'recorded' ? 'Recorded audio' : 'Simulated capture'}
                </Pill>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
