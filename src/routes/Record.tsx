import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, ICONS } from '../components/primitives'
import { useSession } from '../state/session'
import { liveTranscriptSupported, useRecorder } from '../lib/useRecorder'
import {
  askCoach,
  deleteRecording,
  fetchAudioUrl,
  listRecordings,
  recordingsEnabled,
  type CoachSuggestion,
  type RecordingSummary,
} from '../lib/recordingsClient'
import { uploadRecording } from '../lib/recordingsClient'
import { timecode } from '../lib/format'

/** How often to ask for coaching while recording. */
const COACH_INTERVAL_MS = 12_000
/** How often to re-check a recording that is still transcribing. */
const POLL_MS = 4_000

export function Record() {
  const { token, displayName, email } = useSession()
  const speaker = displayName || email?.split('@')[0] || 'You'
  const { state, seconds, level, lines, error, start, stop } = useRecorder(speaker)

  const [recordings, setRecordings] = useState<RecordingSummary[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null)
  const [coaching, setCoaching] = useState(false)
  const transcriptEnd = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      setRecordings(await listRecordings(token))
    } catch {
      // Listing is not worth an error banner; the next poll retries.
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll only while something is still transcribing, then stop.
  useEffect(() => {
    if (!recordings.some((r) => r.status === 'processing')) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [recordings, refresh])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [lines])

  // Ask for a suggestion on a timer rather than on every word: the conversation has to
  // move on far enough for new advice to be worth reading.
  useEffect(() => {
    if (state !== 'recording' || !token) return
    const controller = new AbortController()

    const tick = async () => {
      const recent = lines.filter((l) => l.final).slice(-6)
      if (recent.length === 0) return
      setCoaching(true)
      const result = await askCoach(
        token,
        recent.map((l) => ({ speaker: l.speaker, text: l.text })),
        controller.signal,
      )
      setCoaching(false)
      if (result) setSuggestion(result)
    }

    const id = setInterval(() => void tick(), COACH_INTERVAL_MS)
    return () => {
      clearInterval(id)
      controller.abort()
    }
  }, [state, token, lines])

  const askNow = async () => {
    if (!token) return
    const recent = lines.filter((l) => l.final).slice(-6)
    if (recent.length === 0) {
      setNotice('Say something first — there is nothing to advise on yet.')
      return
    }
    setCoaching(true)
    const result = await askCoach(
      token,
      recent.map((l) => ({ speaker: l.speaker, text: l.text })),
    )
    setCoaching(false)
    if (result) setSuggestion(result)
    else setNotice('Could not reach the coach just now.')
  }

  const finish = async () => {
    const blob = await stop()
    setSuggestion(null)
    if (!blob || !token) {
      setNotice('Nothing was captured.')
      return
    }
    setUploading(true)
    setNotice('')
    try {
      const title = `Recording ${new Date().toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}`
      await uploadRecording(token, blob, title, seconds)
      setNotice('Uploaded. Transcribing now — it appears below when it is ready.')
      await refresh()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  if (!recordingsEnabled || !token) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center md:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">
          Recording needs the backend
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-400">
          This build is running without the API configured, so there is nowhere to store
          audio or transcribe it.
        </p>
      </div>
    )
  }

  const recording = state === 'recording'

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 md:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Record</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-400">
        Captures your microphone, stores the audio, and transcribes it with Whisper. While
        you talk it reads the room and suggests what to say next.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={recording ? finish : start}
                disabled={state === 'requesting' || state === 'stopping' || uploading}
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
                  recording
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-brand-500 text-white hover:bg-brand-600'
                }`}
                aria-label={recording ? 'Stop recording' : 'Start recording'}
              >
                <Icon
                  path={recording ? 'M7 7h10v10H7z' : ICONS.play}
                  className={recording ? 'h-5 w-5 fill-current' : 'h-6 w-6 translate-x-0.5 fill-current'}
                />
              </button>

              <div className="min-w-0 flex-1">
                <p className="font-mono text-[22px] tabular-nums text-white">
                  {timecode(seconds)}
                </p>
                <p className="text-[12px] text-ink-400">
                  {state === 'requesting' && 'Waiting for microphone permission…'}
                  {state === 'recording' && 'Recording'}
                  {state === 'stopping' && 'Finishing…'}
                  {state === 'denied' && 'Microphone blocked'}
                  {state === 'unsupported' && 'Not supported in this browser'}
                  {state === 'idle' && !uploading && 'Ready'}
                  {uploading && 'Uploading…'}
                </p>
              </div>

              {/* A visible level meter is the only honest proof the mic is live. */}
              <div className="flex h-10 items-end gap-[3px]" aria-hidden>
                {Array.from({ length: 14 }).map((_, i) => {
                  const threshold = (i + 1) / 14
                  const on = recording && level >= threshold * 0.75
                  return (
                    <span
                      key={i}
                      className={`w-1 rounded-full transition-all duration-75 ${
                        on ? 'bg-emerald-400' : 'bg-ink-700'
                      }`}
                      style={{ height: `${8 + threshold * 26}px`, opacity: on ? 1 : 0.4 }}
                    />
                  )
                })}
              </div>
            </div>

            {error && <p className="mt-3 text-[12px] text-rose-400">{error}</p>}
            {notice && <p className="mt-3 text-[12px] text-ink-300">{notice}</p>}

            {!liveTranscriptSupported() && (
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                Live text needs the Web Speech API, which this browser does not have. The
                recording and its Whisper transcript still work; only the in-meeting
                coaching is unavailable.
              </p>
            )}
          </div>

          <div className="surface flex h-80 flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-ink-200">Live transcript</h2>
              <span className="text-[11px] text-ink-500">
                rough, for coaching — the kept transcript comes from Whisper
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {lines.length === 0 ? (
                <p className="text-[13px] text-ink-500">
                  {recording ? 'Listening…' : 'Nothing yet.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => (
                    <p
                      key={line.id}
                      className={`text-[13px] leading-relaxed ${
                        line.final ? 'text-ink-200' : 'text-ink-500 italic'
                      }`}
                    >
                      <span className="font-medium text-ink-400">{line.speaker}: </span>
                      {line.text}
                    </p>
                  ))}
                  <div ref={transcriptEnd} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="surface rounded-xl border border-brand-500/25 bg-brand-500/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                <Icon path={ICONS.sparkle} className="h-3.5 w-3.5 text-brand-400" />
                What to say next
              </h2>
              <button
                onClick={askNow}
                disabled={!recording || coaching}
                className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition-colors enabled:hover:border-brand-500/50 enabled:hover:text-white disabled:opacity-50"
              >
                {coaching ? 'Thinking…' : 'Ask now'}
              </button>
            </div>

            {!suggestion ? (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                While you record, this reads the last few things said and suggests a reply
                you could actually use. It updates every few seconds.
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

          <RecordingList recordings={recordings} token={token} onChange={refresh} />
        </div>
      </div>
    </div>
  )
}

function RecordingList({
  recordings,
  token,
  onChange,
}: {
  recordings: RecordingSummary[]
  token: string
  onChange: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (recordings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700 px-4 py-8 text-center">
        <p className="text-[13px] text-ink-300">No recordings yet</p>
        <p className="mt-1 text-[12px] text-ink-500">Your audio and transcript land here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
        Your recordings
      </h2>
      {recordings.map((r) => (
        <RecordingRow
          key={r.id}
          recording={r}
          token={token}
          open={openId === r.id}
          onToggle={() => setOpenId(openId === r.id ? null : r.id)}
          onDeleted={onChange}
        />
      ))}
    </div>
  )
}

function RecordingRow({
  recording,
  token,
  open,
  onToggle,
  onDeleted,
}: {
  recording: RecordingSummary
  token: string
  open: boolean
  onToggle: () => void
  onDeleted: () => void
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<{ t: number; text: string }[] | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (!open || recording.status !== 'ready') return
    let revoked: string | null = null
    let cancelled = false

    void (async () => {
      try {
        const [url, detail] = await Promise.all([
          fetchAudioUrl(token, recording.id),
          import('../lib/recordingsClient').then((m) => m.getRecording(token, recording.id)),
        ])
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        revoked = url
        setAudioUrl(url)
        setTranscript(detail.transcript)
      } catch {
        // Leave the row collapsed-but-present rather than showing a broken player.
      }
    })()

    return () => {
      cancelled = true
      // Object URLs hold the blob in memory until revoked.
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [open, recording.id, recording.status, token])

  const remove = async () => {
    await deleteRecording(token, recording.id).catch(() => {})
    onDeleted()
  }

  return (
    <div className="surface rounded-xl border border-ink-800 bg-ink-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-medium text-ink-100">{recording.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
            <span>{Math.round(recording.duration_s)}s</span>
            <span>·</span>
            <span>{Math.round(recording.bytes / 1024)} KB</span>
            <span>·</span>
            <span
              className={
                recording.status === 'ready'
                  ? 'text-emerald-400'
                  : recording.status === 'failed'
                    ? 'text-rose-400'
                    : 'text-brand-400'
              }
            >
              {recording.status === 'processing'
                ? 'transcribing…'
                : recording.status === 'failed'
                  ? 'transcription failed'
                  : `${recording.lines} lines`}
            </span>
          </p>
        </button>
        <button
          onClick={remove}
          aria-label={`Delete ${recording.title}`}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-500 transition-colors hover:bg-ink-800 hover:text-rose-400"
        >
          Delete
        </button>
      </div>

      {open && recording.status === 'ready' && (
        <div className="rise mt-3 space-y-3 border-t border-ink-800 pt-3">
          {audioUrl ? (
            <audio ref={audio} src={audioUrl} controls className="w-full" preload="metadata" />
          ) : (
            <p className="text-[12px] text-ink-500">Loading audio…</p>
          )}

          {transcript && transcript.length > 0 && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto">
              {transcript.map((line, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (audio.current) {
                      audio.current.currentTime = line.t
                      void audio.current.play()
                    }
                  }}
                  className="flex w-full gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-ink-850"
                >
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-500">
                    {timecode(line.t)}
                  </span>
                  <span className="text-[12px] leading-relaxed text-ink-300">{line.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
