export type Platform = 'zoom' | 'meet' | 'teams'

export type TemplateId =
  | 'general'
  | 'sales-discovery'
  | 'one-on-one'
  | 'standup'
  | 'customer-success'
  | 'interview'
  | 'product-review'

export interface Person {
  id: string
  name: string
  title: string
  org: string
  external?: boolean
}

export interface TranscriptLine {
  /** Seconds from the start of the recording. */
  t: number
  speaker: string
  text: string
}

export interface Chapter {
  id: string
  title: string
  start: number
  end: number
  gist: string
}

export interface ActionItem {
  id: string
  text: string
  owner: string | null
  t: number
  due?: string
  done?: boolean
}

export interface Highlight {
  id: string
  title: string
  start: number
  end: number
  createdBy: string
  note?: string
}

export interface SummarySection {
  heading: string
  bullets: string[]
}

export interface Summary {
  headline: string
  sections: SummarySection[]
}

export interface Meeting {
  id: string
  title: string
  /** ISO 8601, local to the host. */
  date: string
  durationSec: number
  platform: Platform
  host: string
  participants: string[]
  team: string
  status: 'ready' | 'processing'
  defaultTemplate: TemplateId
  summaries: Partial<Record<TemplateId, Summary>>
  chapters: Chapter[]
  actionItems: ActionItem[]
  highlights: Highlight[]
  transcript: TranscriptLine[]
}
