import { MEETINGS } from '../data'
import { person } from '../data/people'
import { search } from './search'
import type { SavedMeetingSummary } from './meetingsClient'

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export const askEnabled = Boolean(API_BASE)

export interface Passage {
  id: string
  meeting: string
  meetingId: string
  t?: number
  text: string
  /** Set for a call the user actually had, as opposed to the sample library. */
  saved?: boolean
}

export interface AskResult {
  answer: string
  citations: string[]
  confident: boolean
  followUp: string | null
}

/** Caps so one question cannot ship a whole corpus to the model. */
const MAX_PASSAGES = 20
const MAX_PASSAGE_CHARS = 650

/**
 * Gathers the passages most likely to answer a question.
 *
 * Reuses the same ranking the in-app search uses — summaries and action items outrank
 * passing transcript mentions — rather than standing up a second retrieval path that
 * could disagree with it. Saved calls are mixed in and given a slight edge, because a
 * question about "the call" almost always means the recent real one.
 */
export function gatherPassages(
  question: string,
  savedMeetings: SavedMeetingSummary[] = [],
  savedTranscripts: Record<string, { t: number; speaker: string; text: string }[]> = {},
): Passage[] {
  const passages: Passage[] = []
  const seen = new Set<string>()

  const push = (p: Passage) => {
    const key = `${p.meetingId}:${p.text.slice(0, 80)}`
    if (seen.has(key) || passages.length >= MAX_PASSAGES) return
    seen.add(key)
    passages.push({ ...p, text: p.text.slice(0, MAX_PASSAGE_CHARS) })
  }

  // Saved calls first: "what did we decide on the call" means the real one.
  const terms = question.toLowerCase().split(/[^a-z0-9']+/).filter((t) => t.length > 2)
  for (const meeting of savedMeetings) {
    const summary = meeting.summary
    if (summary) {
      push({
        id: `s${passages.length + 1}`,
        meeting: meeting.title,
        meetingId: `call:${meeting.id}`,
        text: summary.headline,
        saved: true,
      })
      for (const decision of summary.decisions.slice(0, 3)) {
        push({
          id: `s${passages.length + 1}`,
          meeting: meeting.title,
          meetingId: `call:${meeting.id}`,
          text: `Decision: ${decision}`,
          saved: true,
        })
      }
      for (const action of summary.actionItems.slice(0, 4)) {
        push({
          id: `s${passages.length + 1}`,
          meeting: meeting.title,
          meetingId: `call:${meeting.id}`,
          t: action.t,
          text: `Action: ${action.text}${action.owner ? ` — owner ${action.owner}` : ''}`,
          saved: true,
        })
      }
    }

    for (const line of savedTranscripts[meeting.id] ?? []) {
      if (terms.some((t) => line.text.toLowerCase().includes(t))) {
        push({
          id: `s${passages.length + 1}`,
          meeting: meeting.title,
          meetingId: `call:${meeting.id}`,
          t: line.t,
          text: `${line.speaker}: ${line.text}`,
          saved: true,
        })
      }
    }
  }

  // Then the ranked results from the sample library.
  for (const group of search(question, 40)) {
    for (const hit of group.hits.slice(0, 4)) {
      const speaker = hit.speaker ? `${person(hit.speaker).name}: ` : ''
      push({
        id: `m${passages.length + 1}`,
        meeting: group.meeting.title,
        meetingId: group.meeting.id,
        t: hit.t,
        text: `${speaker}${hit.text}`,
      })
    }
  }

  return passages
}

export async function askAcrossMeetings(
  token: string,
  question: string,
  passages: Passage[],
): Promise<AskResult> {
  const response = await fetch(`${API_BASE}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question,
      passages: passages.map((p) => ({ id: p.id, meeting: p.meeting, t: p.t, text: p.text })),
    }),
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = ((await response.json()) as { error?: string }).error ?? ''
    } catch {
      // Non-JSON body.
    }
    throw new Error(detail || `ask failed (${response.status})`)
  }

  return ((await response.json()) as { result: AskResult }).result
}

/** Where a cited passage lives, so an answer can be checked rather than trusted. */
export function citationLink(passage: Passage): string {
  if (passage.meetingId.startsWith('call:')) return `/call/${passage.meetingId.slice(5)}`
  const at = passage.t !== undefined ? `?t=${Math.max(0, Math.floor(passage.t) - 3)}` : ''
  return `/m/${passage.meetingId}${at}`
}

export const SUGGESTED_QUESTIONS = [
  'What did we decide about SSO, and who owns telling the customer?',
  'What is still unresolved across my meetings?',
  'What did I commit to, and by when?',
  'Which customers have asked about SCIM?',
  'What is blocking the ingestion work?',
]

export const hasSampleMeetings = MEETINGS.length > 0
