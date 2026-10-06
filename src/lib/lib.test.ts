import { describe, expect, it } from 'vitest'
import { redactForPublic, redactLines } from './redaction'
import { lineDuration, speakerStats } from './analytics'
import { search, segments } from './search'
import { findActive } from './transcript'
import { dueLabel, isOverdue, timecode } from './format'
import { getMeeting, MEETINGS } from '../data'

const roadmap = getMeeting('q3-roadmap-review')!

describe('redaction at the public boundary', () => {
  it('masks emails, cards and credentials', () => {
    expect(redactForPublic('reach me at priya@northbeam.io').text).toContain('[email removed]')
    expect(redactForPublic('card 4111 1111 1111 1111 expires').text).toContain(
      '[card number removed]',
    )
    expect(redactForPublic('token sk-livekey9876543210abc here').text).toContain(
      '[credential removed]',
    )
  })

  it('leaves ordinary speech and timecodes alone', () => {
    const plain = 'We shipped four of six commitments in Q2, about 58 minutes of discussion.'
    expect(redactForPublic(plain).text).toBe(plain)
  })

  it('reports which categories were removed', () => {
    const result = redactForPublic('mail a@b.co or call 555 0147')
    expect(result.removed).toContain('email')
  })

  it('is stable when applied repeatedly', () => {
    const once = redactForPublic('a@b.co').text
    expect(redactForPublic(once).text).toBe(once)
  })

  it('does not mutate the input lines', () => {
    const lines = [{ text: 'hello a@b.co' }]
    const { lines: out } = redactLines(lines)
    expect(lines[0].text).toBe('hello a@b.co')
    expect(out[0].text).not.toBe(lines[0].text)
  })

  it('returns the identical object when nothing changed', () => {
    const lines = [{ text: 'nothing sensitive here' }]
    const { lines: out } = redactLines(lines)
    expect(out[0]).toBe(lines[0])
  })
})

describe('talk-time estimation', () => {
  it('never exceeds the gap before the next line', () => {
    const lines = [
      { t: 0, speaker: 'a', text: 'word '.repeat(200).trim() },
      { t: 5, speaker: 'b', text: 'short' },
    ]
    expect(lineDuration(lines, 0, 100)).toBeLessThanOrEqual(5)
  })

  it('shares sum to roughly one across participants', () => {
    const total = speakerStats(roadmap).reduce((a, s) => a + s.share, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('includes participants who never spoke, at zero', () => {
    const stats = speakerStats(roadmap)
    expect(stats).toHaveLength(roadmap.participants.length)
    expect(stats.every((s) => s.seconds >= 0)).toBe(true)
  })

  it('handles an empty transcript without dividing by zero', () => {
    const empty = MEETINGS.find((m) => m.transcript.length === 0)!
    expect(() => speakerStats(empty)).not.toThrow()
    expect(speakerStats(empty).every((s) => s.share === 0)).toBe(true)
  })
})

describe('search', () => {
  it('finds a term across more than one meeting', () => {
    const groups = search('SCIM')
    expect(groups.length).toBeGreaterThan(1)
  })

  it('ranks summary and action hits above passing transcript mentions', () => {
    const [first] = search('ingestion rewrite')
    expect(['summary', 'action']).toContain(first.hits[0].kind)
  })

  it('returns nothing for an empty or noise query', () => {
    expect(search('')).toHaveLength(0)
    expect(search('   ')).toHaveLength(0)
    expect(search('zzzzqqqq')).toHaveLength(0)
  })

  it('does not break on regex metacharacters', () => {
    expect(() => search('a(b[c')).not.toThrow()
    expect(() => segments('text', 'a(b[c')).not.toThrow()
  })

  it('splits text into matched and unmatched segments', () => {
    const parts = segments('the SCIM requirement', 'scim')
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['SCIM'])
    expect(parts.map((p) => p.text).join('')).toBe('the SCIM requirement')
  })
})

describe('transcript cursor', () => {
  it('is -1 before the first line and tracks forwards', () => {
    expect(findActive(roadmap, -1)).toBe(-1)
    expect(findActive(roadmap, 0)).toBe(-1)
    expect(findActive(roadmap, roadmap.transcript[0].t)).toBe(0)
    expect(findActive(roadmap, roadmap.durationSec)).toBe(roadmap.transcript.length - 1)
  })
})

describe('formatting', () => {
  it('renders hours only when the recording passes an hour', () => {
    expect(timecode(0)).toBe('0:00')
    expect(timecode(65)).toBe('1:05')
    expect(timecode(3605)).toBe('1:00:05')
  })

  it('clamps negative input rather than printing a negative clock', () => {
    expect(timecode(-10)).toBe('0:00')
  })

  it('treats the whole due day as on time', () => {
    const today = new Date('2026-10-06T09:00:00')
    expect(isOverdue('2026-10-06', today)).toBe(false)
    expect(isOverdue('2026-10-05', today)).toBe(true)
    expect(dueLabel('2026-10-06', today)).toBe('Due today')
  })
})
