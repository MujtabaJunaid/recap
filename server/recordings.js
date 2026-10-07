/**
 * Real audio: upload, transcribe, store, serve back.
 *
 * The capture layer in the rest of this project is simulated. This is not — it takes
 * actual recorded audio, sends it to Whisper, and keeps the bytes so they can be played
 * again.
 *
 * Scope, stated honestly: this records the microphone of whoever is using the app. It
 * is not a bot that joins a Zoom call and captures every participant. That needs a
 * meeting-platform integration, and it is the one piece still missing.
 */
import { createRecording, setRecordingFailed, setTranscript } from './db.js'

const UPSTREAM = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = process.env.WHISPER_MODEL || 'whisper-large-v3-turbo'

/** 25MB is roughly 25 minutes of Opus at the bitrate the browser records at. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TRANSCRIBE_TIMEOUT_MS = 120_000

/** Only formats a browser actually produces, and only ones Whisper accepts. */
const ALLOWED_MIME = new Map([
  ['audio/webm', 'webm'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4', 'mp4'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
])

export function normaliseMime(raw) {
  const value = String(raw || '').toLowerCase().trim()
  if (ALLOWED_MIME.has(value)) return { mime: value, ext: ALLOWED_MIME.get(value) }
  const base = value.split(';')[0].trim()
  if (ALLOWED_MIME.has(base)) return { mime: base, ext: ALLOWED_MIME.get(base) }
  return null
}

/**
 * Container sniffing by magic bytes. A client-declared content type is a claim, not
 * evidence, and this decides what gets sent to a third party and served back later.
 */
export function looksLikeAudio(buffer) {
  if (buffer.length < 12) return false
  const ascii = (start, length) => buffer.subarray(start, start + length).toString('latin1')

  if (ascii(0, 4) === 'OggS') return true // Ogg
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return true // WAV
  if (ascii(4, 4) === 'ftyp') return true // MP4 / M4A
  if (ascii(0, 3) === 'ID3') return true // MP3 with tags
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true // bare MPEG frame
  // Matroska / WebM EBML header
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return true
  }
  return false
}

/**
 * Whisper returns segments with start and end times. The app's transcript shape is
 * `{ t, speaker, text }`, so segments map onto it directly and every existing consumer
 * — sync, seeking, clips, search — works on a real recording with no change.
 */
export function segmentsToTranscript(segments, speaker) {
  if (!Array.isArray(segments)) return []
  return segments
    .map((s) => ({
      t: Math.max(0, Math.round(Number(s.start) || 0)),
      speaker,
      text: String(s.text || '').trim(),
    }))
    .filter((line) => line.text.length > 0)
}

export async function transcribe(audio, mime, ext, apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS)

  try {
    const form = new FormData()
    form.append('file', new Blob([audio], { type: mime }), `recording.${ext}`)
    form.append('model', MODEL)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')

    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`upstream ${response.status}`)

    const body = await response.json()
    return {
      segments: body.segments ?? [],
      duration: Number(body.duration) || 0,
      language: body.language,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stores first, transcribes second, and does not make the client wait for Whisper.
 *
 * Storing first means a transcription failure leaves a playable recording rather than
 * losing the audio entirely — the one irreplaceable thing in the request.
 */
export async function ingest({ userId, title, mime, ext, audio, durationSeconds, apiKey, log }) {
  const row = await createRecording({ userId, title, mime, audio, durationSeconds })

  const work = (async () => {
    try {
      const result = await transcribe(audio, mime, ext, apiKey)
      const transcript = segmentsToTranscript(result.segments, `user-${userId}`)
      await setTranscript(row.id, userId, transcript)
      log('info', 'recording.transcribed', {
        recordingId: String(row.id),
        lines: transcript.length,
        durationS: Math.round(result.duration),
      })
    } catch (error) {
      // No message: a provider error can quote the payload it rejected.
      await setRecordingFailed(row.id, userId, 'transcription failed')
      log('error', 'recording.transcribe_failed', {
        recordingId: String(row.id),
        errorName: error?.name,
      })
    }
  })()

  return { row, work }
}

/** Live chunks are short by construction; a 20s opus slice is tens of kilobytes. */
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024

/**
 * Transcribes one slice of a call in progress and keeps nothing.
 *
 * The live path is deliberately not the storage path. Each slice is a self-contained
 * container recorded by a fresh MediaRecorder, so it decodes on its own; the gapless
 * archive is recorded separately and uploaded once at the end. Text returned here is
 * for the person in the call and for the coach, and is never the record of truth.
 */
export async function transcribeChunk(audio, mime, ext, apiKey) {
  const { segments } = await transcribe(audio, mime, ext, apiKey)
  const text = segments
    .map((s) => String(s.text || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  return text.slice(0, 2000)
}
