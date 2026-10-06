import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Microphone recording, live level metering, and a live interim transcript.
 *
 * Two independent streams of truth, deliberately:
 *
 *   - `MediaRecorder` produces the audio that gets uploaded and transcribed properly
 *     by Whisper afterwards. That is the recording of record.
 *   - The browser's SpeechRecognition gives rough text *while you are still talking*,
 *     which is what the live coach needs. It is not accurate enough to keep, and it is
 *     never stored — it exists only so advice can arrive during the conversation.
 *
 * Scope, stated plainly: this captures the microphone of whoever is using the app. It
 * is not a bot joining a call and capturing every participant.
 */

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'denied' | 'unsupported'

export interface LiveLine {
  id: number
  speaker: string
  text: string
  final: boolean
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

function speechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Impl = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Impl ? new Impl() : null
}

export const liveTranscriptSupported = () =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition,
  )

export function useRecorder(speakerLabel: string) {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [lines, setLines] = useState<LiveLine[]>([])
  const [error, setError] = useState('')

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const frame = useRef<number | undefined>(undefined)
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const nextId = useRef(0)
  const resolveBlob = useRef<((blob: Blob | null) => void) | null>(null)

  /** Releases the microphone. A tab holding an open mic shows a recording indicator. */
  const teardown = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    if (ticker.current !== undefined) clearInterval(ticker.current)
    frame.current = undefined
    ticker.current = undefined

    recognition.current?.abort()
    recognition.current = null

    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null

    void audioContext.current?.close().catch(() => {})
    audioContext.current = null
    setLevel(0)
  }, [])

  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    setError('')
    setLines([])
    setSeconds(0)
    chunks.current = []

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      setError('This browser cannot record audio.')
      return
    }

    setState('requesting')
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      setState('denied')
      setError('Microphone access was refused. Recap cannot record without it.')
      return
    }

    stream.current = media

    // Opus in WebM where available; Safari needs mp4. Falling back to the browser
    // default is better than failing, since the server sniffs the container anyway.
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported(t))

    const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    recorder.current = rec
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
      resolveBlob.current?.(blob.size > 0 ? blob : null)
      resolveBlob.current = null
    }
    // Timeslice so a crash mid-recording still leaves usable chunks behind.
    rec.start(1000)

    // Level meter, for visible proof the microphone is actually picking something up.
    const ctx = new AudioContext()
    audioContext.current = ctx
    const source = ctx.createMediaStreamSource(media)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    const meter = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
      setLevel(Math.min(1, peak / 90))
      frame.current = requestAnimationFrame(meter)
    }
    frame.current = requestAnimationFrame(meter)

    ticker.current = setInterval(() => setSeconds((s) => s + 1), 1000)

    // Live text for the coach. Best-effort: it is unavailable in Firefox, and a
    // failure here must not stop the recording, which is the part that matters.
    const sr = speechRecognition()
    if (sr) {
      sr.continuous = true
      sr.interimResults = true
      sr.lang = 'en-GB'
      sr.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const text = result[0]?.transcript?.trim()
          if (!text) continue
          const final = result.isFinal

          setLines((prev) => {
            const interimIndex = prev.findIndex((l) => !l.final)
            const line: LiveLine = {
              id: interimIndex >= 0 ? prev[interimIndex].id : nextId.current++,
              speaker: speakerLabel,
              text,
              final,
            }
            if (interimIndex >= 0) {
              const next = [...prev]
              next[interimIndex] = line
              return next
            }
            return [...prev, line]
          })
        }
      }
      sr.onerror = () => {
        // Usually no-speech or a transient network blip. The recording continues.
      }
      sr.onend = () => {
        // Chrome stops it after a pause; restart while still recording.
        if (recorder.current?.state === 'recording') {
          try {
            sr.start()
          } catch {
            // Already starting; nothing to do.
          }
        }
      }
      try {
        sr.start()
        recognition.current = sr
      } catch {
        recognition.current = null
      }
    }

    setState('recording')
  }, [speakerLabel])

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (recorder.current?.state !== 'recording') return null
    setState('stopping')

    const blob = await new Promise<Blob | null>((resolve) => {
      resolveBlob.current = resolve
      recorder.current?.stop()
    })

    teardown()
    setState('idle')
    return blob
  }, [teardown])

  return { state, seconds, level, lines, error, start, stop }
}
