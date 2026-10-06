const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export const savedMeetingsEnabled = Boolean(API_BASE)

export interface SavedActionItem {
  id: string
  text: string
  owner: string | null
  t: number
  done: boolean
}

export interface SavedSummary {
  title: string
  headline: string
  decisions: string[]
  actionItems: SavedActionItem[]
  openQuestions: string[]
}

export interface SavedMeetingSummary {
  id: string
  title: string
  platform: string
  source: 'simulated' | 'recorded'
  duration_s: number
  status: 'processing' | 'ready' | 'failed'
  participants: string[]
  summary: SavedSummary | null
  created_at: string
  lines: number
}

export interface SavedMeetingDetail extends Omit<SavedMeetingSummary, 'lines'> {
  transcript: { t: number; speaker: string; text: string }[]
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = ((await response.json()) as { error?: string }).error ?? ''
    } catch {
      // Non-JSON body.
    }
    throw new Error(detail || `request failed (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export function saveMeeting(
  token: string,
  meeting: {
    title: string
    platform: string
    source: string
    durationSeconds: number
    participants: string[]
    transcript: { t: number; speaker: string; text: string }[]
  },
) {
  return call<{ meeting: SavedMeetingSummary }>('/api/meetings', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meeting),
  }).then((r) => r.meeting)
}

export function listSavedMeetings(token: string) {
  return call<{ meetings: SavedMeetingSummary[] }>('/api/meetings', token).then((r) => r.meetings)
}

export function getSavedMeeting(token: string, id: string) {
  return call<{ meeting: SavedMeetingDetail }>(`/api/meetings/${id}`, token).then((r) => r.meeting)
}

export function deleteSavedMeeting(token: string, id: string) {
  return call<void>(`/api/meetings/${id}`, token, { method: 'DELETE' })
}
