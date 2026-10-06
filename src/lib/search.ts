import { MEETINGS } from '../data'
import { person } from '../data/people'
import type { Meeting } from '../data/types'

export type ResultKind = 'transcript' | 'summary' | 'action' | 'highlight'

export interface SearchHit {
  kind: ResultKind
  meeting: Meeting
  /** Seconds to seek to when the hit is opened. */
  t?: number
  speaker?: string
  text: string
  score: number
}

export interface SearchGroup {
  meeting: Meeting
  hits: SearchHit[]
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1)
}

function matchScore(haystack: string, tokens: string[], phrase: string): number {
  const text = haystack.toLowerCase()
  if (tokens.length === 0) return 0
  let hit = 0
  for (const token of tokens) {
    if (text.includes(token)) hit++
  }
  if (hit === 0) return 0
  let score = hit / tokens.length
  if (tokens.length > 1 && text.includes(phrase)) score += 0.5
  return score
}

const KIND_WEIGHT: Record<ResultKind, number> = {
  summary: 1.3,
  action: 1.2,
  highlight: 1.15,
  transcript: 1,
}

export function search(query: string, limit = 60): SearchGroup[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const phrase = query.trim().toLowerCase()
  const hits: SearchHit[] = []

  for (const meeting of MEETINGS) {
    const push = (kind: ResultKind, text: string, t?: number, speaker?: string) => {
      const score = matchScore(text, tokens, phrase)
      if (score > 0) hits.push({ kind, meeting, text, t, speaker, score: score * KIND_WEIGHT[kind] })
    }

    const titleScore = matchScore(meeting.title, tokens, phrase)

    for (const summary of Object.values(meeting.summaries)) {
      push('summary', summary.headline)
      for (const section of summary.sections) {
        for (const bullet of section.bullets) push('summary', bullet)
      }
    }

    for (const item of meeting.actionItems) {
      const owner = item.owner ? person(item.owner).name : 'Unassigned'
      push('action', `${item.text} — ${owner}`, item.t, item.owner ?? undefined)
    }

    for (const highlight of meeting.highlights) {
      push('highlight', highlight.title, highlight.start, highlight.createdBy)
    }

    for (const line of meeting.transcript) {
      push('transcript', line.text, line.t, line.speaker)
    }

    if (titleScore > 0 && !hits.some((h) => h.meeting.id === meeting.id)) {
      hits.push({ kind: 'summary', meeting, text: meeting.title, score: titleScore * 1.5 })
    }
  }

  const grouped = new Map<string, SearchHit[]>()
  for (const hit of hits.sort((a, b) => b.score - a.score).slice(0, limit)) {
    const list = grouped.get(hit.meeting.id)
    if (list) list.push(hit)
    else grouped.set(hit.meeting.id, [hit])
  }

  return [...grouped.entries()]
    .map(([id, list]) => ({ meeting: list[0].meeting, hits: list, id }))
    .sort((a, b) => b.hits[0].score - a.hits[0].score)
    .map(({ meeting, hits: list }) => ({ meeting, hits: list }))
}

export interface Segment {
  text: string
  hit: boolean
}

/** Splits text into alternating plain/matched segments for highlighting in the UI. */
export function segments(text: string, query: string): Segment[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return [{ text, hit: false }]
  const pattern = new RegExp(`(${tokens.map(escape).join('|')})`, 'ig')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: tokens.includes(part.toLowerCase()) }))
}

function escape(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
