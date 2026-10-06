import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'
import { useWorkspace } from '../state/workspace'
import {
  askAcrossMeetings,
  askEnabled,
  citationLink,
  gatherPassages,
  SUGGESTED_QUESTIONS,
  type AskResult,
  type Passage,
} from '../lib/askClient'
import { listSavedMeetings, type SavedMeetingSummary } from '../lib/meetingsClient'
import { timecode } from '../lib/format'

/**
 * One place to ask anything about what was said, rather than remembering which call it
 * was in.
 *
 * Every answer carries citations that link to the meeting and the second, so it can be
 * checked rather than trusted. An answer the model cannot support is shown as exactly
 * that — the refusal is a feature, because a confident wrong answer about what someone
 * committed to is worse than no answer.
 */

interface Exchange {
  question: string
  result: AskResult | null
  passages: Passage[]
  error?: string
}

export function Ask() {
  const { token } = useSession()
  const { hasMeetings } = useWorkspace()
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<Exchange[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SavedMeetingSummary[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    void listSavedMeetings(token)
      .then(setSaved)
      .catch(() => {
        // Sample meetings alone still answer most questions.
      })
  }, [token])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [history, busy])

  const submit = async (text: string) => {
    const q = text.trim()
    if (!q || !token || busy) return

    setQuestion('')
    setBusy(true)
    const passages = gatherPassages(q, saved)

    if (passages.length === 0) {
      setHistory((h) => [
        ...h,
        { question: q, result: null, passages: [], error: 'Nothing in your meetings touches that.' },
      ])
      setBusy(false)
      return
    }

    try {
      const result = await askAcrossMeetings(token, q, passages)
      setHistory((h) => [...h, { question: q, result, passages }])
    } catch (e) {
      setHistory((h) => [
        ...h,
        {
          question: q,
          result: null,
          passages,
          error: e instanceof Error ? e.message : 'Could not answer that.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  if (!askEnabled || !token) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center md:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">Ask needs the backend</h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-400">
          Answering across meetings runs server-side, and the API is not configured here.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-3xl flex-col px-4 py-7 md:px-6">
      <div>
        <h1 className="display text-[28px] font-semibold leading-tight tracking-tight">
          Stop guessing. Ask.
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink-400">
          One question across every meeting you have. Each answer cites the call and the
          second it came from, so you can check it.
        </p>
      </div>

      {history.length === 0 && (
        <div className="mt-7">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Try one of these
          </p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => void submit(q)}
                disabled={busy}
                className="surface surface-hover rounded-xl border border-ink-800 bg-ink-900 p-3 text-left text-[13px] leading-snug text-ink-300 transition-colors hover:border-brand-500/40 hover:text-white disabled:opacity-60"
              >
                {q}
              </button>
            ))}
          </div>
          {!hasMeetings && saved.length === 0 && (
            <p className="mt-4 text-[12px] text-ink-500">
              Your workspace is empty, so there is nothing to search yet. Load the sample
              workspace or join a call first.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex-1 space-y-6">
        {history.map((item, i) => (
          <div key={i} className="rise">
            <p className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold text-ink-200">
                Q
              </span>
              <span className="text-[14px] font-medium leading-relaxed text-white">
                {item.question}
              </span>
            </p>

            {item.error ? (
              <p className="mt-2.5 pl-7 text-[13px] text-rose-300">{item.error}</p>
            ) : item.result ? (
              <div className="mt-2.5 pl-7">
                <p className="text-[14px] leading-relaxed text-ink-200">{item.result.answer}</p>

                {!item.result.confident && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-200">
                    Not supported by anything in your meetings — treat as a gap, not an answer.
                  </p>
                )}

                {item.result.citations.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                      From
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {item.result.citations.map((id) => {
                        const p = item.passages.find((x) => x.id === id)
                        if (!p) return null
                        return (
                          <Link
                            key={id}
                            to={citationLink(p)}
                            className="block rounded-lg border border-ink-800 bg-ink-900 p-2.5 transition-colors hover:border-brand-500/40"
                          >
                            <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                              <span className="font-medium text-brand-400">{p.meeting}</span>
                              {p.t !== undefined && (
                                <span className="font-mono tabular-nums">{timecode(p.t)}</span>
                              )}
                              {p.saved && (
                                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
                                  your call
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-[12px] leading-relaxed text-ink-300">
                              {p.text}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}

                {item.result.followUp && (
                  <button
                    onClick={() => void submit(item.result!.followUp!)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition-colors hover:border-brand-500/50 hover:text-white"
                  >
                    {item.result.followUp}
                    <Icon path={ICONS.arrow} className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 pl-7 text-[13px] text-ink-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
            </span>
            Reading your meetings…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(question)
        }}
        className="sticky bottom-0 mt-6 bg-gradient-to-t from-ink-950 via-ink-950 to-transparent pb-2 pt-4"
      >
        <div className="relative">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your meetings"
            aria-label="Ask anything about your meetings"
            className="w-full rounded-xl border border-ink-700 bg-ink-900 py-3 pl-4 pr-28 text-sm text-ink-200 outline-none placeholder:text-ink-500 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
          />
          <button
            type="submit"
            disabled={busy || question.trim().length === 0}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>
    </div>
  )
}
