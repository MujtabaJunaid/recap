import { logger } from './observability'

/**
 * Talks to the recording and live-coach endpoints. Every call needs a session token;
 * without a backend these features are simply unavailable rather than faked.
 */

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export const recordingsEnabled = Boolean(API_BASE)

export interface RecordingSummary {
  id: string
  title: string
  mime: string
  bytes: number
  duration_s: number
  status: 'processing' | 'ready' | 'failed'
  error: string | null
  created_at: string
  lines: number
}

export interface TranscriptLine {
  t: number
  speaker: string
  text: string
}

export interface RecordingDetail extends Omit<RecordingSummary, 'lines'> {
  transcript: TranscriptLine[]
}

export interface CoachSuggestion {
  read: string
  sayNext: string
  because: string
  watchOut: string | null
}

class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = ((await response.json()) as { error?: string }).error ?? ''
    } catch {
      // Non-JSON error body.
    }
    throw new ApiError(detail || `request failed (${response.status})`, response.status)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export async function uploadRecording(
  token: string,
  blob: Blob,
  title: string,
  durationSeconds: number,
): Promise<RecordingSummary> {
  const response = await fetch(`${API_BASE}/api/recordings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': blob.type || 'audio/webm',
      // Headers must be latin-1; a title can hold anything a person types.
      'x-recording-title': encodeURIComponent(title),
      'x-recording-duration': String(Math.round(durationSeconds)),
    },
    body: blob,
  })

  if (response.status === 413) throw new ApiError('That recording is too large.', 413)
  if (response.status === 415) throw new ApiError('That audio format is not supported.', 415)
  if (!response.ok) throw new ApiError(`Upload failed (${response.status})`, response.status)

  return ((await response.json()) as { recording: RecordingSummary }).recording
}

/**
 * Transcribes one slice of a call in progress. Nothing is stored server-side; the
 * gapless archive is uploaded separately when the call ends.
 *
 * Returning empty text is the common case rather than a failure: most slices of most
 * conversations are one side listening.
 */
export async function transcribeSlice(
  token: string,
  blob: Blob,
  side: 'me' | 'them',
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/transcribe-chunk`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': blob.type || 'audio/webm',
      'x-chunk-side': side,
    },
    body: blob,
  })
  if (!response.ok) throw new ApiError(`slice failed (${response.status})`, response.status)
  return ((await response.json()) as { text: string }).text ?? ''
}

export function listRecordings(token: string) {
  return request<{ recordings: RecordingSummary[] }>('/api/recordings', token).then(
    (r) => r.recordings,
  )
}

export function getRecording(token: string, id: string) {
  return request<{ recording: RecordingDetail }>(`/api/recordings/${id}`, token).then(
    (r) => r.recording,
  )
}

export function deleteRecording(token: string, id: string) {
  return request<void>(`/api/recordings/${id}`, token, { method: 'DELETE' })
}

/**
 * Audio is behind auth, so it cannot be an `<audio src>` directly — the element sends
 * no Authorization header. Fetch it and hand the element an object URL instead.
 */
export async function fetchAudioUrl(token: string, id: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/recordings/${id}/audio`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new ApiError(`Could not load audio (${response.status})`, response.status)
  return URL.createObjectURL(await response.blob())
}

export async function askCoach(
  token: string,
  lines: { speaker: string; text: string }[],
  signal?: AbortSignal,
): Promise<CoachSuggestion | null> {
  try {
    const response = await fetch(`${API_BASE}/api/live-coach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ lines: lines.slice(-6) }),
      signal,
    })
    if (!response.ok) return null
    return ((await response.json()) as { suggestion: CoachSuggestion }).suggestion
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null
    // Coaching is an assist, not the product. A failure is silent by design: an error
    // banner mid-meeting costs more attention than the missing suggestion.
    logger.warn('coach.failed', { errorName: error instanceof Error ? error.name : 'Unknown' })
    return null
  }
}
