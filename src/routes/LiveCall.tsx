import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'
import {
  askCoach,
  recordingsEnabled,
  transcribeSlice,
  uploadRecording,
  type CoachSuggestion,
} from '../lib/recordingsClient'
import { saveMeeting } from '../lib/meetingsClient'
import { captureSupported, useLiveCapture, type Side } from '../lib/useLiveCapture'
import { timecode } from '../lib/format'

/**
 * Sits in a real call — Zoom, Meet, Teams, anything with sound — and takes notes.
 *
 * No bot joins the meeting and no participant sees Recap, because nothing here touches
 * a meeting platform's API. Your voice comes from the microphone and everyone else's
 * comes from the audio of the window you share, which is why the far side is captured
 * at all. Both halves are transcribed separately, so attribution is a fact about which
 * device the audio arrived on rather than a diarisation guess.
 *
 * The honest limits are stated in the UI rather than buried here: Chrome or Edge on
 * desktop, and either a shared browser tab or the whole screen with system audio on.
 */

type Phase = 'ready' | 'live' | 'saving' | 'saved' | 'failed'

const COACH_AFTER_LINES = 2

export function LiveCall() {
  const { token, displayName, email } = useSession()
  const navigate = useNavigate()
  const you = displayName || email?.split('@')[0] || 'You'

  const [phase, setPhase] = useState<Phase>('ready')
  const [title, setTitle] = useState('')
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null)
  const [coaching, setCoaching] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)

  const feedEnd = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const coachedAt = useRef(0)

  const slice = useCallback(
    (blob: Blob, side: Side) => {
      if (!token) return Promise.resolve('')
      return transcribeSlice(token, blob, side)
    },
    [token],
  )

  const {
    state,
    seconds,
    levels,
    lines,
    error,
    pending,
    sliceErrors,
    farHeard,
    start,
    stop,
  } = useLiveCapture({
    transcribeSlice: slice,
  })

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lines])

  useEffect(() => () => abort.current?.abort(), [])

  const requestCoaching = useCallback(async () => {
    if (!token || lines.length === 0) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    setCoaching(true)
    const result = await askCoach(
      token,
      lines.slice(-5).map((l) => ({ speaker: l.side === 'me' ? you : 'Them', text: l.text })),
      controller.signal,
    )
    setCoaching(false)
    if (result) setSuggestion(result)
  }, [token, lines, you])

  /**
   * Coaches on the far side's words, not your own. Advice on what to say next is only
   * useful after someone else has spoken, and asking on every slice would burn the
   * rate limit on your own thinking-out-loud.
   */
  useEffect(() => {
    if (state !== 'live') return
    const theirs = lines.filter((l) => l.side === 'them').length
    if (theirs >= COACH_AFTER_LINES && theirs > coachedAt.current) {
      coachedAt.current = theirs
      void requestCoaching()
    }
  }, [lines, state, requestCoaching])

  const begin = async () => {
    setSuggestion(null)
    setNotice('')
    coachedAt.current = 0
    // Only move off the pre-flight screen if audio is genuinely flowing. Showing a live
    // call that never started is how a silent capture failure becomes invisible.
    if (await start()) setPhase('live')
  }

  const finish = async () => {
    setPhase('saving')
    const blob = await stop()

    const name = title.trim() || `Live call · ${new Date().toLocaleString('en-GB')}`

    /**
     * A meeting needs a transcript, so there is nothing to save without one. Pressing
     * save anyway used to reach the server and come back "invalid request", which named
     * the rule instead of the problem.
     *
     * The audio is still worth keeping: uploading it runs the whole file through Whisper
     * server-side, which recovers the transcript the live slices failed to produce.
     */
    if (lines.length === 0) {
      if (blob) {
        try {
          await uploadRecording(token!, blob, name, seconds)
          setPhase('ready')
          setNotice(
            farHeard
              ? 'No speech was transcribed live, so there was no meeting to file. The audio is saved and is being transcribed in full — check Recordings shortly.'
              : 'Nothing was heard from the call, only your own microphone. The audio is saved and is being transcribed in full. Next time, share a browser tab or tick "Share system audio".',
          )
          return
        } catch {
          setPhase('failed')
          setNotice('Nothing was transcribed, and the audio could not be stored either.')
          return
        }
      }
      setPhase('ready')
      setNotice('Nothing was captured, so there is nothing to save.')
      return
    }

    try {
      const meeting = await saveMeeting(token!, {
        title: name,
        platform: 'zoom',
        source: 'live',
        durationSeconds: seconds,
        participants: [you, 'Other participants'],
        transcript: lines.map((l) => ({
          t: l.t,
          speaker: l.side === 'me' ? you : 'Them',
          text: l.text,
        })),
      })
      setSavedId(String(meeting.id))

      // The audio is secondary to the transcript: a failed upload must not lose the
      // meeting that was already saved.
      if (blob) {
        try {
          await uploadRecording(token!, blob, name, seconds)
        } catch {
          setNotice('The notes were saved. The audio file could not be stored.')
        }
      }

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
          Live capture needs the backend
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-400">
          Transcription and coaching both run server-side, and the API is not configured
          in this build.
        </p>
      </div>
    )
  }

  const unsupported = !captureSupported()

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-[28px] font-semibold leading-tight tracking-tight">
            Take notes in a real call
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-ink-400">
            Recap listens to both sides of a call you are already in, writes the
            transcript as it happens, coaches you on what to say, and files the summary
            when you hang up.
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          Real audio
        </span>
      </div>

      {unsupported && (
        <p className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-[13px] leading-relaxed text-amber-200">
          This browser cannot capture call audio. Chrome or Edge on a desktop can; Safari
          and Firefox cannot share system audio.
        </p>
      )}

      {phase === 'ready' && !unsupported && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-5">
            <h2 className="text-[15px] font-semibold text-white">Before you start</h2>
            <ol className="mt-3 space-y-3">
              {[
                {
                  head: 'Join the call as you normally would',
                  body: 'Recap does not join it for you and nobody is told it is here. It listens from your machine.',
                },
                {
                  head: 'Use headphones if you have them',
                  body: 'Without them your microphone also hears the far side through the speakers, and both get transcribed twice.',
                },
                {
                  head: 'When the picker opens, share the call',
                  body: 'A browser tab if the call is in a tab — Zoom, Meet and Teams all have a web client. For the Zoom desktop app, choose Entire screen and tick "Share system audio".',
                },
                {
                  head: 'Allow the microphone',
                  body: 'That is your own side. The two are recorded separately, which is how the transcript knows who said what.',
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[11px] font-semibold text-brand-400">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium text-white">{step.head}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-400">
                      {step.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <label className="mt-5 block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Call name
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Northwind check-in"
                aria-label="Call name"
                className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-[13px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-brand-500/60"
              />
            </label>

            <button
              onClick={() => void begin()}
              disabled={state === 'requesting'}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              <Icon path={ICONS.play} className="h-4 w-4 fill-current" />
              {state === 'requesting' ? 'Waiting for permission…' : 'Start listening'}
            </button>

            {error && <p className="mt-3 text-[12px] leading-relaxed text-rose-300">{error}</p>}
            {notice && <p className="mt-3 text-[12px] text-ink-300">{notice}</p>}
          </div>

          <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-5">
            <h2 className="text-[13px] font-semibold text-white">What this does and does not do</h2>
            <dl className="mt-3 space-y-3 text-[12px] leading-relaxed">
              <div>
                <dt className="font-medium text-emerald-300">Real</dt>
                <dd className="mt-0.5 text-ink-400">
                  Your microphone and the call's own audio, transcribed by Whisper every
                  15 seconds, coached by a model on what was actually just said, then
                  summarised and stored against your account with the audio.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-amber-300">Not real</dt>
                <dd className="mt-0.5 text-ink-400">
                  There is no bot in the meeting and no Zoom integration. Recap cannot
                  speak to the other participants, and it cannot name them — the far side
                  is attributed as "Them", because without the platform's API there is no
                  honest way to know which voice belongs to whom.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink-200">Private</dt>
                <dd className="mt-0.5 text-ink-400">
                  Audio slices are transcribed and discarded; only the finished recording
                  is stored, and only against your own account. Recording a call usually
                  needs everyone's consent — that part is on you.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {(state === 'live' || state === 'stopping' || phase === 'saving') &&
        phase !== 'saved' &&
        phase !== 'failed' && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="surface flex h-[30rem] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                  </span>
                  <span className="text-[13px] font-semibold text-ink-200">Listening</span>
                  <span className="font-mono text-[12px] tabular-nums text-ink-400">
                    {timecode(seconds)}
                  </span>
                  {pending > 0 && (
                    <span className="text-[11px] text-ink-500">transcribing {pending}…</span>
                  )}
                </div>
                <button
                  onClick={() => void finish()}
                  disabled={phase === 'saving'}
                  className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
                >
                  {phase === 'saving' ? 'Saving…' : 'Stop and save'}
                </button>
              </div>

              {/* Both banners exist because the first version of this screen failed
                  silently: a blocked upload and an empty room looked identical. */}
              {sliceErrors >= 2 && (
                <p className="border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[12px] leading-relaxed text-rose-200">
                  Transcription is failing — {sliceErrors} slices in a row did not come
                  back. The audio is still recording and will be transcribed in full when
                  you stop, so nothing is being lost.
                </p>
              )}
              {sliceErrors < 2 && seconds > 40 && !farHeard && (
                <p className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-[12px] leading-relaxed text-amber-200">
                  Nothing has been heard from the call in {seconds} seconds — only your
                  own microphone. Either nobody else has spoken, or the share is not
                  sending audio.
                </p>
              )}

              <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
                {lines.length === 0 && (
                  <p className="text-[13px] leading-relaxed text-ink-500">
                    Listening. The first lines appear after about 15 seconds — that is one
                    slice of audio, which is what Whisper needs to transcribe accurately.
                  </p>
                )}
                {lines.map((line) => {
                  const mine = line.side === 'me'
                  return (
                    <div key={line.id} className="rise">
                      <p className="flex items-baseline gap-2">
                        <span
                          className={`text-[12px] font-semibold ${mine ? 'text-brand-400' : 'text-ink-200'}`}
                        >
                          {mine ? you : 'Them'}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-ink-500">
                          {timecode(line.t)}
                        </span>
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
                    onClick={() => void requestCoaching()}
                    disabled={coaching || lines.length === 0}
                    className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition-colors enabled:hover:border-brand-500/50 enabled:hover:text-white disabled:opacity-50"
                  >
                    {coaching ? 'Thinking…' : 'Ask now'}
                  </button>
                </div>

                {!suggestion ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                    {coaching ? 'Reading the room…' : 'A suggestion appears once the other side has spoken.'}
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

              {/* The meters are the diagnosis. A flat "the call" bar means the share
                  carried no audio, which is the one failure people cannot otherwise see. */}
              <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-4">
                <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                  Audio arriving
                </h2>
                <div className="mt-3 space-y-3">
                  {(
                    [
                      { key: 'me' as const, label: `${you} (microphone)`, tone: 'bg-brand-400' },
                      { key: 'them' as const, label: 'The call (shared audio)', tone: 'bg-emerald-400' },
                    ]
                  ).map((row) => (
                    <div key={row.key}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-ink-300">{row.label}</span>
                        <span className="font-mono text-[10px] tabular-nums text-ink-500">
                          {Math.round(levels[row.key] * 100)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                        <div
                          className={`h-full rounded-full ${row.tone} transition-[width] duration-75`}
                          style={{ width: `${Math.max(2, levels[row.key] * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                  If the second bar never moves, the window you shared is not sending
                  audio. Stop, and share a browser tab or the entire screen with system
                  audio enabled.
                </p>
              </div>
            </div>
          </div>
        )}

      {phase === 'saved' && (
        <div className="surface mt-8 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5">
          <h2 className="text-[15px] font-semibold text-white">Call saved and summarised</h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-300">
            {lines.length} lines of transcript are stored with the audio, and a summary
            with action items is being written. It appears on your dashboard as soon as it
            is ready.
          </p>
          {notice && <p className="mt-2 text-[12px] text-amber-200">{notice}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => navigate(savedId ? `/call/${savedId}` : '/')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
            >
              Open the call
              <Icon path={ICONS.arrow} className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setPhase('ready')
                setSavedId(null)
                setNotice('')
              }}
              className="rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
            >
              Record another
            </button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="mt-8 rounded-xl border border-rose-500/25 bg-rose-500/5 p-5">
          <h2 className="text-[15px] font-semibold text-white">Could not save the call</h2>
          <p className="mt-1.5 text-[13px] text-ink-300">{notice}</p>
          <button
            onClick={() => setPhase('ready')}
            className="mt-4 rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-white"
          >
            Back
          </button>
        </div>
      )}
    </div>
  )
}
