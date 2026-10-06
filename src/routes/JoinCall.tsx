import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'
import { SCENARIOS, scenarioDuration, YOU, type CallScenario, type ScriptLine } from '../data/callScript'
import { askCoach, recordingsEnabled, type CoachSuggestion } from '../lib/recordingsClient'
import { saveMeeting } from '../lib/meetingsClient'
import { timecode } from '../lib/format'

/**
 * A simulated call that drives the real pipeline.
 *
 * What is simulated: the conversation. There is no bot in a Zoom room — making one
 * needs the Zoom Meeting SDK and marketplace approval, and the brief explicitly allows
 * stubbing capture.
 *
 * What is real: the lines arrive on a clock rather than all at once, the live coach is
 * a real model call on whatever has actually been said so far, and leaving the call
 * sends the transcript to be summarised by a real model and stored against your
 * account. Everything after capture is the genuine article.
 */

type Phase = 'lobby' | 'joining' | 'live' | 'saving' | 'saved' | 'failed'

/** Replays faster than real time; a 2.5-minute call is tedious to sit through. */
const SPEED = 4

export function JoinCall() {
  const { token, displayName, email } = useSession()
  const navigate = useNavigate()
  const you = displayName || email?.split('@')[0] || YOU

  const [scenario, setScenario] = useState<CallScenario>(SCENARIOS[0])
  const [phase, setPhase] = useState<Phase>('lobby')
  const [, setElapsed] = useState(0)
  const [heard, setHeard] = useState<ScriptLine[]>([])
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null)
  const [coaching, setCoaching] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)

  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const coached = useRef<Set<number>>(new Set())
  const feedEnd = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  const cleanup = useCallback(() => {
    if (timer.current !== undefined) clearInterval(timer.current)
    timer.current = undefined
    abort.current?.abort()
    abort.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [heard])

  const requestCoaching = useCallback(
    async (context: ScriptLine[]) => {
      if (!token || context.length === 0) return
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller

      setCoaching(true)
      const result = await askCoach(
        token,
        context.slice(-5).map((l) => ({ speaker: l.speaker, text: l.text })),
        controller.signal,
      )
      setCoaching(false)
      if (result) setSuggestion(result)
    },
    [token],
  )

  const join = () => {
    setPhase('joining')
    setHeard([])
    setElapsed(0)
    setSuggestion(null)
    setNotice('')
    coached.current = new Set()

    // A beat of "joining" so the state is legible rather than instantaneous.
    setTimeout(() => {
      setPhase('live')
      timer.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1

          const due = scenario.lines.filter((l) => l.t <= next * SPEED)
          setHeard((current) => (due.length === current.length ? current : due))

          // Coach when the room turns to you, once per moment.
          const latest = due[due.length - 1]
          if (latest?.addressedToYou && !coached.current.has(latest.t)) {
            coached.current.add(latest.t)
            void requestCoaching(due)
          }

          if (next * SPEED >= scenarioDuration(scenario)) {
            if (timer.current !== undefined) clearInterval(timer.current)
            timer.current = undefined
          }
          return next
        })
      }, 1000)
    }, 900)
  }

  const leave = async () => {
    cleanup()
    if (!token || heard.length === 0) {
      setPhase('lobby')
      setNotice('Nothing was said, so there is nothing to save.')
      return
    }

    setPhase('saving')
    try {
      const meeting = await saveMeeting(token, {
        title: scenario.name,
        platform: scenario.platform,
        source: 'simulated',
        durationSeconds: heard[heard.length - 1].t,
        participants: scenario.participants.map((p) => (p === YOU ? you : p)),
        transcript: heard.map((l) => ({
          t: l.t,
          speaker: l.speaker === YOU ? you : l.speaker,
          text: l.text,
        })),
      })
      setSavedId(String(meeting.id))
      setPhase('saved')
    } catch (e) {
      setPhase('failed')
      setNotice(e instanceof Error ? e.message : 'Could not save the call.')
    }
  }

  if (!recordingsEnabled || !token) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center md:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">
          Joining a call needs the backend
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-400">
          Live coaching and summarisation both run server-side, and the API is not
          configured in this build.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Join a call</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-400">
            Recap sits in the call, writes down what is said, coaches you while it happens,
            and files the summary afterwards.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          Simulated call
        </span>
      </div>

      <p className="mt-3 max-w-3xl rounded-lg border border-ink-800 bg-ink-900 p-3 text-[12px] leading-relaxed text-ink-400">
        <span className="text-ink-300">What is real and what is not:</span> the conversation
        is scripted — there is no bot in a Zoom room, which needs the Zoom SDK and
        marketplace approval. Everything downstream is real: lines arrive on a clock, the
        coaching is a live model call on what has actually been said, and leaving sends the
        transcript to be summarised and saved to your account.
      </p>

      {phase === 'lobby' && (
        <div className="mt-6 space-y-3">
          {SCENARIOS.map((s) => {
            const active = s.id === scenario.id
            return (
              <button
                key={s.id}
                onClick={() => setScenario(s)}
                className={`surface surface-hover block w-full rounded-xl border p-4 text-left ${
                  active
                    ? 'border-brand-500/50 bg-brand-500/10'
                    : 'border-ink-800 bg-ink-900 hover:border-ink-600'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-white">{s.name}</span>
                  <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    {s.platform}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-400">{s.blurb}</p>
                <p className="mt-2 text-[11px] text-ink-500">
                  {s.participants.length} participants · {Math.round(scenarioDuration(s) / 60)} min
                </p>
              </button>
            )
          })}

          <button
            onClick={join}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-brand-600"
          >
            <Icon path={ICONS.play} className="h-4 w-4 fill-current" />
            Join the call
          </button>
          {notice && <p className="text-[12px] text-ink-300">{notice}</p>}
        </div>
      )}

      {phase === 'joining' && (
        <div className="mt-10 flex items-center gap-3 text-ink-300">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-400" />
          </span>
          Recap is joining {scenario.name}…
        </div>
      )}

      {(phase === 'live' || phase === 'saving') && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="surface flex h-[30rem] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                </span>
                <span className="text-[13px] font-semibold text-ink-200">Recording</span>
                <span className="font-mono text-[12px] tabular-nums text-ink-400">
                  {timecode(heard.length ? heard[heard.length - 1].t : 0)}
                </span>
              </div>
              <button
                onClick={leave}
                disabled={phase === 'saving'}
                className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
              >
                {phase === 'saving' ? 'Saving…' : 'Leave and save'}
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {heard.length === 0 && (
                <p className="text-[13px] text-ink-500">Waiting for someone to speak…</p>
              )}
              {heard.map((line, i) => {
                const mine = line.speaker === YOU
                return (
                  <div key={i} className="rise">
                    <p className="flex items-baseline gap-2">
                      <span
                        className={`text-[12px] font-semibold ${mine ? 'text-brand-400' : 'text-ink-200'}`}
                      >
                        {mine ? you : line.speaker}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-ink-500">
                        {timecode(line.t)}
                      </span>
                      {line.addressedToYou && (
                        <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-brand-400">
                          to you
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-300">{line.text}</p>
                  </div>
                )
              })}
              <div ref={feedEnd} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="surface rounded-xl border border-brand-500/25 bg-brand-500/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                  <Icon path={ICONS.sparkle} className="h-3.5 w-3.5 text-brand-400" />
                  What to say next
                </h2>
                <button
                  onClick={() => void requestCoaching(heard)}
                  disabled={coaching || heard.length === 0}
                  className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition-colors enabled:hover:border-brand-500/50 enabled:hover:text-white disabled:opacity-50"
                >
                  {coaching ? 'Thinking…' : 'Ask now'}
                </button>
              </div>

              {!suggestion ? (
                <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                  {coaching
                    ? 'Reading the room…'
                    : 'When the room turns to you, a suggestion appears here.'}
                </p>
              ) : (
                <div className="rise mt-3 space-y-3">
                  <p className="text-[12px] leading-relaxed text-ink-400">{suggestion.read}</p>
                  <blockquote className="border-l-2 border-brand-500 pl-3 text-[14px] leading-relaxed text-white">
                    {suggestion.sayNext}
                  </blockquote>
                  <p className="text-[12px] leading-relaxed text-ink-400">
                    <span className="text-ink-300">Why:</span> {suggestion.because}
                  </p>
                  {suggestion.watchOut && (
                    <p className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2 text-[12px] leading-relaxed text-amber-200">
                      <span className="font-medium">Careful:</span> {suggestion.watchOut}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-4">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                In the call
              </h2>
              <div className="mt-2 space-y-1.5">
                {scenario.participants.map((p) => {
                  const name = p === YOU ? you : p
                  const speaking = heard[heard.length - 1]?.speaker === p
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${speaking ? 'bg-emerald-400' : 'bg-ink-700'}`}
                      />
                      <span
                        className={`text-[13px] ${speaking ? 'text-white' : 'text-ink-400'}`}
                      >
                        {name}
                        {p === YOU && <span className="text-ink-600"> (you)</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'saved' && (
        <div className="surface mt-8 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5">
          <h2 className="text-[15px] font-semibold text-white">Call saved and summarised</h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-300">
            The transcript is stored and a summary with action items is being generated. It
            appears on your dashboard as soon as it is ready.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
            >
              Go to the dashboard
              <Icon path={ICONS.arrow} className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setPhase('lobby')
                setSavedId(null)
              }}
              className="rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
            >
              Join another
            </button>
          </div>
          {savedId && <p className="mt-3 text-[11px] text-ink-500">Meeting #{savedId}</p>}
        </div>
      )}

      {phase === 'failed' && (
        <div className="mt-8 rounded-xl border border-rose-500/25 bg-rose-500/5 p-5">
          <h2 className="text-[15px] font-semibold text-white">Could not save the call</h2>
          <p className="mt-1.5 text-[13px] text-ink-300">{notice}</p>
          <button
            onClick={() => setPhase('lobby')}
            className="mt-4 rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
          >
            Back
          </button>
        </div>
      )}
    </div>
  )
}
