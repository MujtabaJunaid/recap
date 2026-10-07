import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Captures both sides of a real call and transcribes them while it happens.
 *
 * There is no bot in the meeting and no Zoom SDK. The far side arrives through
 * `getDisplayMedia`, which hands over the audio of a shared tab or of the whole screen,
 * and your own voice arrives through `getUserMedia`. Keeping them as two streams rather
 * than one mixed blob is what makes attribution real: each side is transcribed on its
 * own, so "you said" and "they said" is a property of which device the audio came from
 * rather than a guess a diarisation model made.
 *
 * Three recorders run at once, for three different jobs:
 *   - one per side, restarted every slice, because a WebM fragment is only decodable
 *     with its own header and Whisper needs a complete container
 *   - one on the mixed stream, continuous, which is the archive that gets stored
 *
 * The sliced text is for the person in the call and for the coach. The mixed recording
 * is the record of truth, and it is the only one that is kept.
 */

export type CaptureState =
  | 'idle'
  | 'requesting'
  | 'live'
  | 'stopping'
  | 'denied'
  | 'no-far-audio'
  | 'unsupported'

export type Side = 'me' | 'them'

export interface CaptureLine {
  id: number
  side: Side
  text: string
  t: number
}

/** Long enough for Whisper to have context, short enough to feel live. */
const SLICE_MS = 15_000

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
}

export function captureSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(navigator.mediaDevices?.getDisplayMedia)
  )
}

interface Options {
  /** Transcribes one slice. Returning empty text is normal: most slices are silence. */
  transcribeSlice: (blob: Blob, side: Side) => Promise<string>
}

export function useLiveCapture({ transcribeSlice }: Options) {
  const [state, setState] = useState<CaptureState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<{ me: number; them: number }>({ me: 0, them: 0 })
  const [lines, setLines] = useState<CaptureLine[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(0)
  const [sliceErrors, setSliceErrors] = useState(0)
  /** Whether the far side has ever been audible. A flat meter is the one failure that
   *  is invisible from the transcript alone. */
  const [farHeard, setFarHeard] = useState(false)

  const micStream = useRef<MediaStream | null>(null)
  const farStream = useRef<MediaStream | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const archive = useRef<MediaRecorder | null>(null)
  const archiveChunks = useRef<Blob[]>([])
  const slicers = useRef<MediaRecorder[]>([])
  const sliceTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)
  const nextId = useRef(0)
  const startedAt = useRef(0)
  const live = useRef(false)
  const resolveArchive = useRef<((b: Blob | null) => void) | null>(null)

  const teardown = useCallback(() => {
    live.current = false
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    if (sliceTimer.current !== undefined) clearInterval(sliceTimer.current)
    if (ticker.current !== undefined) clearInterval(ticker.current)
    frame.current = undefined
    sliceTimer.current = undefined
    ticker.current = undefined

    for (const rec of slicers.current) {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        // Already stopped.
      }
    }
    slicers.current = []

    micStream.current?.getTracks().forEach((t) => t.stop())
    farStream.current?.getTracks().forEach((t) => t.stop())
    micStream.current = null
    farStream.current = null

    void ctx.current?.close().catch(() => {})
    ctx.current = null
    setLevels({ me: 0, them: 0 })
  }, [])

  useEffect(() => teardown, [teardown])

  const push = useCallback((side: Side, text: string, t: number) => {
    const clean = text.trim()
    if (!clean) return
    setLines((prev) => [...prev, { id: nextId.current++, side, text: clean, t }])
  }, [])

  /**
   * Runs one slice per side: record for SLICE_MS, close the container, send it up.
   *
   * Restarting rather than using `requestData` is deliberate. A timeslice fragment has
   * no header of its own, so Whisper rejects every chunk after the first. The cost is a
   * few tens of milliseconds at each boundary, and that cost lands only on the live
   * text, never on the archive, which records straight through.
   */
  const runSlice = useCallback(
    (stream: MediaStream, side: Side, mimeType: string | undefined) => {
      if (!live.current || stream.getAudioTracks().length === 0) return

      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      } catch {
        return
      }

      const parts: Blob[] = []
      const at = Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data)
      }
      rec.onstop = () => {
        slicers.current = slicers.current.filter((r) => r !== rec)
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1024) return

        setPending((n) => n + 1)
        void transcribeSlice(blob, side)
          .then((text) => {
            push(side, text, at)
            setSliceErrors(0)
          })
          .catch(() => {
            // One lost slice must not end the call — the archive still holds the audio —
            // but a run of them means nothing is being transcribed, and continuing in
            // silence is how a broken call looks identical to a quiet one.
            setSliceErrors((n) => n + 1)
          })
          .finally(() => setPending((n) => Math.max(0, n - 1)))
      }

      slicers.current.push(rec)
      rec.start()
      setTimeout(() => {
        try {
          if (rec.state === 'recording') rec.stop()
        } catch {
          // Track ended underneath us.
        }
      }, SLICE_MS)
    },
    [push, transcribeSlice],
  )

  /** Resolves true only once audio is genuinely flowing, so the caller cannot show a
   *  live call that never started. */
  const start = useCallback(async (): Promise<boolean> => {
    setError('')
    setLines([])
    setSeconds(0)
    setPending(0)
    setSliceErrors(0)
    setFarHeard(false)
    archiveChunks.current = []

    if (!captureSupported()) {
      setState('unsupported')
      setError('This browser cannot capture call audio. Chrome or Edge on desktop can.')
      return false
    }

    setState('requesting')

    // The far side first: it opens a picker, and there is no point holding the
    // microphone open while someone decides which window to share.
    let far: MediaStream
    try {
      far = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch {
      setState('denied')
      setError('Screen sharing was cancelled, so there is no way to hear the other side.')
      return false
    }

    // Video is requested only because Chrome will not offer audio without it, and is
    // dropped immediately: this records a conversation, not a screen.
    for (const track of far.getVideoTracks()) {
      track.stop()
      far.removeTrack(track)
    }

    if (far.getAudioTracks().length === 0) {
      far.getTracks().forEach((t) => t.stop())
      setState('no-far-audio')
      setError(
        'That share carried no audio. Share a browser tab, or the entire screen with "Share system audio" ticked.',
      )
      return false
    }

    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      far.getTracks().forEach((t) => t.stop())
      setState('denied')
      setError('Microphone access was refused, so your own side cannot be recorded.')
      return false
    }

    farStream.current = far
    micStream.current = mic

    // Ending the share from Chrome's own bar is a legitimate way to end a call.
    far.getAudioTracks()[0].addEventListener('ended', () => {
      if (live.current) setState('stopping')
    })

    const audio = new AudioContext()
    ctx.current = audio
    const micSource = audio.createMediaStreamSource(mic)
    const farSource = audio.createMediaStreamSource(far)

    const mixed = audio.createMediaStreamDestination()
    micSource.connect(mixed)
    farSource.connect(mixed)

    const mimeType = pickMime()
    const rec = new MediaRecorder(mixed.stream, mimeType ? { mimeType } : undefined)
    archive.current = rec
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) archiveChunks.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(archiveChunks.current, { type: rec.mimeType || 'audio/webm' })
      resolveArchive.current?.(blob.size > 0 ? blob : null)
      resolveArchive.current = null
    }
    rec.start(1000)

    // One analyser per side, so the meters prove which half is actually arriving. A
    // silent "them" meter is the whole diagnosis when a share carried no audio.
    const meterFor = (node: MediaStreamAudioSourceNode) => {
      const analyser = audio.createAnalyser()
      analyser.fftSize = 512
      node.connect(analyser)
      return { analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) }
    }
    const meters = { me: meterFor(micSource), them: meterFor(farSource) }

    const peak = ({
      analyser,
      data,
    }: {
      analyser: AnalyserNode
      data: Uint8Array<ArrayBuffer>
    }) => {
      analyser.getByteTimeDomainData(data)
      let p = 0
      for (const v of data) p = Math.max(p, Math.abs(v - 128))
      return Math.min(1, p / 90)
    }

    const tick = () => {
      const next = { me: peak(meters.me), them: peak(meters.them) }
      setLevels(next)
      // Well clear of the noise floor, so a hiss does not count as hearing anyone.
      if (next.them > 0.08) setFarHeard(true)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)

    startedAt.current = Date.now()
    live.current = true
    ticker.current = setInterval(() => setSeconds((s) => s + 1), 1000)

    runSlice(mic, 'me', mimeType)
    runSlice(far, 'them', mimeType)
    sliceTimer.current = setInterval(() => {
      runSlice(mic, 'me', mimeType)
      runSlice(far, 'them', mimeType)
    }, SLICE_MS)

    setState('live')
    return true
  }, [runSlice])

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (archive.current?.state !== 'recording') {
      teardown()
      setState('idle')
      return null
    }
    setState('stopping')

    // Stop the slicers first so their final audio still reaches the transcript.
    for (const rec of slicers.current) {
      try {
        if (rec.state === 'recording') rec.stop()
      } catch {
        // Already stopped.
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      resolveArchive.current = resolve
      archive.current?.stop()
    })

    teardown()
    setState('idle')
    return blob
  }, [teardown])

  return { state, seconds, levels, lines, error, pending, sliceErrors, farHeard, start, stop }
}
