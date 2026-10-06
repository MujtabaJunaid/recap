import type { Meeting, TemplateId } from './types'
import { q3Roadmap } from './meetings/q3-roadmap'
import {
  acmeDiscovery,
  priyaDanielOneOnOne,
  northwindRenewal,
  engStandup,
  onboardingDesignReview,
  supportEscalation,
  boardPrep,
} from './meetings/library'

export const MEETINGS: Meeting[] = [
  boardPrep,
  supportEscalation,
  engStandup,
  acmeDiscovery,
  priyaDanielOneOnOne,
  q3Roadmap,
  northwindRenewal,
  onboardingDesignReview,
].sort((a, b) => b.date.localeCompare(a.date))

const BY_ID = new Map(MEETINGS.map((m) => [m.id, m]))

export function getMeeting(id: string | undefined): Meeting | undefined {
  return id ? BY_ID.get(id) : undefined
}

export const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'product-review', label: 'Product review' },
  { id: 'sales-discovery', label: 'Sales discovery' },
  { id: 'customer-success', label: 'Customer success' },
  { id: 'one-on-one', label: '1:1' },
  { id: 'standup', label: 'Standup' },
  { id: 'interview', label: 'Interview' },
]

export const TEMPLATE_LABELS = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t.label]),
) as Record<TemplateId, string>

export interface SharedClip {
  id: string
  meetingId: string
  highlightId: string
  sharedBy: string
  sharedWith: string
  note?: string
}

/** Clips that have been shared out of the workspace. Readable without a session. */
export const SHARED_CLIPS: SharedClip[] = [
  {
    id: 'ck-7f2a91',
    meetingId: 'q3-roadmap-review',
    highlightId: 'h1',
    sharedBy: 'priya',
    sharedWith: 'the engineering channel',
    note: 'For anyone who missed the roadmap review — this is the actual decision on the rewrite.',
  },
  {
    id: 'ck-3d80b4',
    meetingId: 'northwind-renewal',
    highlightId: 'h1',
    sharedBy: 'sofia',
    sharedWith: 'Tom Reyes, Priya Raman',
    note: 'Nadia raised the SSO date herself. This is why 1 Nov is not movable.',
  },
  {
    id: 'ck-9b1e55',
    meetingId: 'latency-escalation',
    highlightId: 'h1',
    sharedBy: 'rachel',
    sharedWith: 'Acme Logistics support thread',
    note: 'Root cause for the intermittent latency you reported.',
  },
]

const CLIPS_BY_ID = new Map(SHARED_CLIPS.map((c) => [c.id, c]))

export function getSharedClip(id: string | undefined): SharedClip | undefined {
  return id ? CLIPS_BY_ID.get(id) : undefined
}
