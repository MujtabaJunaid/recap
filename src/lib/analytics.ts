import type { Meeting, TranscriptLine } from '../data/types'

/**
 * Transcripts carry a start time per line but no end time, so speaking duration is
 * estimated from word count and clamped to the gap before the next line. Good enough
 * for a talk-time split; not a substitute for diarisation timings.
 */
const WORDS_PER_SECOND = 2.6

export interface SpeakerStat {
  speaker: string
  seconds: number
  share: number
  turns: number
  longestTurn: number
}

export function lineDuration(lines: TranscriptLine[], index: number, meetingEnd: number): number {
  const line = lines[index]
  const words = line.text.split(/\s+/).filter(Boolean).length
  const spoken = words / WORDS_PER_SECOND
  const next = lines[index + 1]
  const gap = (next ? next.t : meetingEnd) - line.t
  return Math.max(1, Math.min(spoken, Math.max(gap, 1)))
}

export function speakerStats(meeting: Meeting): SpeakerStat[] {
  const seconds = new Map<string, number>()
  const turns = new Map<string, number>()
  const longest = new Map<string, number>()

  meeting.transcript.forEach((line, i) => {
    const d = lineDuration(meeting.transcript, i, meeting.durationSec)
    seconds.set(line.speaker, (seconds.get(line.speaker) ?? 0) + d)
    longest.set(line.speaker, Math.max(longest.get(line.speaker) ?? 0, d))
    const previous = meeting.transcript[i - 1]
    if (!previous || previous.speaker !== line.speaker) {
      turns.set(line.speaker, (turns.get(line.speaker) ?? 0) + 1)
    }
  })

  const total = [...seconds.values()].reduce((a, b) => a + b, 0) || 1

  return meeting.participants
    .map((speaker) => ({
      speaker,
      seconds: seconds.get(speaker) ?? 0,
      share: (seconds.get(speaker) ?? 0) / total,
      turns: turns.get(speaker) ?? 0,
      longestTurn: longest.get(speaker) ?? 0,
    }))
    .sort((a, b) => b.seconds - a.seconds)
}

export interface MeetingInsight {
  label: string
  detail: string
  tone: 'neutral' | 'warn'
}

export function meetingInsights(meeting: Meeting): MeetingInsight[] {
  const stats = speakerStats(meeting)
  const out: MeetingInsight[] = []
  if (stats.length === 0) return out

  const top = stats[0]
  if (meeting.participants.length > 2 && top.share > 0.35) {
    out.push({
      label: 'Dominated',
      detail: `${Math.round(top.share * 100)}% of the talk time came from one person`,
      tone: 'warn',
    })
  }

  const silent = stats.filter((s) => s.seconds === 0)
  if (silent.length > 0) {
    out.push({
      label: 'Did not speak',
      detail: `${silent.length} ${silent.length === 1 ? 'person' : 'people'} never spoke`,
      tone: 'warn',
    })
  }

  const questions = meeting.transcript.filter((l) => l.text.includes('?')).length
  if (questions > 0) {
    out.push({
      label: 'Questions asked',
      detail: `${questions} across the call`,
      tone: 'neutral',
    })
  }

  const unowned = meeting.actionItems.filter((a) => !a.owner).length
  if (unowned > 0) {
    out.push({
      label: 'Unowned actions',
      detail: `${unowned} action ${unowned === 1 ? 'item has' : 'items have'} no owner`,
      tone: 'warn',
    })
  }

  const monologue = stats.find((s) => s.longestTurn > 45)
  if (monologue) {
    out.push({
      label: 'Longest single turn',
      detail: `${Math.round(monologue.longestTurn)}s uninterrupted`,
      tone: 'neutral',
    })
  }

  return out
}

/** Per-speaker occupancy across N equal time buckets, for the speaker timeline strip. */
export function speakerTimeline(meeting: Meeting, buckets: number): Record<string, number[]> {
  const width = meeting.durationSec / buckets
  const grid: Record<string, number[]> = {}
  for (const p of meeting.participants) grid[p] = new Array(buckets).fill(0)

  meeting.transcript.forEach((line, i) => {
    const row = grid[line.speaker]
    if (!row) return
    const duration = lineDuration(meeting.transcript, i, meeting.durationSec)
    const from = Math.floor(line.t / width)
    const to = Math.min(buckets - 1, Math.floor((line.t + duration) / width))
    for (let b = from; b <= to; b++) {
      if (b >= 0 && b < buckets) row[b] = Math.min(1, row[b] + 0.6)
    }
  })

  return grid
}
