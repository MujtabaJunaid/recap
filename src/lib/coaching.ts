import type { ActionItem, Meeting } from '../data/types'
import { person } from '../data/people'
import { dueLabel } from './format'

/**
 * Turns an action item into a call to action and a way to actually start it.
 *
 * On naming: these are **work styles the person chooses for themselves**, not clinical
 * categories and not a guess the product makes about anyone. The underlying need is
 * real — the hard part of a task is rarely the work, it is starting, or knowing when to
 * stop — but a meeting tool has no business inferring a diagnosis, so the user picks.
 *
 * Generation is deterministic here because this build has no backend and therefore no
 * safe way to hold a model key. `lib/prompts.ts` carries the schema and system prompt
 * for the hosted version; both produce the same `ActionPlan` shape, so swapping one for
 * the other changes no UI.
 */

export type WorkStyleId = 'momentum' | 'precise' | 'steady' | 'deep' | 'collaborative'

export interface WorkStyle {
  id: WorkStyleId
  label: string
  /** How the person describes themselves, in their words rather than a category. */
  blurb: string
}

export const WORK_STYLES: WorkStyle[] = [
  {
    id: 'momentum',
    label: 'Hard to start',
    blurb: 'Starting is the obstacle. Give me something small enough that refusing feels silly.',
  },
  {
    id: 'precise',
    label: 'Needs a finish line',
    blurb: 'I will keep polishing without one. Tell me what done looks like, and when to stop.',
  },
  {
    id: 'steady',
    label: 'One thing at a time',
    blurb: 'No urgency theatre. Show me the next single step and nothing after it.',
  },
  {
    id: 'deep',
    label: 'Long uninterrupted block',
    blurb: 'Context switching costs me more than the task. Batch it and protect the time.',
  },
  {
    id: 'collaborative',
    label: 'Think it through with someone',
    blurb: 'I get unstuck by talking. Point me at who to pull in first.',
  },
]

/**
 * Defaults to the style built around the hardest part being *starting*, which is the
 * common ask. Every user can change it, and nothing is ever inferred about anyone.
 */
export const DEFAULT_WORK_STYLE: WorkStyleId = 'momentum'

export type TaskKind = 'write' | 'send' | 'confirm' | 'build' | 'schedule' | 'decide' | 'general'

/** Verb-led classification. Meeting commitments almost always start with their verb. */
export function classifyTask(text: string): TaskKind {
  const t = text.toLowerCase()
  if (/\b(write|draft|spec|document|one-pager|summaris|summariz)\b/.test(t)) return 'write'
  if (/\b(send|share|email|forward|circulate|pass on)\b/.test(t)) return 'send'
  if (/\b(confirm|verify|check|chase|follow up|get sign-?off)\b/.test(t)) return 'confirm'
  if (/\b(build|run|prototype|implement|instrument|migrat|fix|quarantine)\b/.test(t))
    return 'build'
  if (/\b(book|schedule|move|invite|set up|arrange)\b/.test(t)) return 'schedule'
  if (/\b(decide|choose|approve|cut|open the req|prioriti)\b/.test(t)) return 'decide'
  return 'general'
}

export interface ActionPlan {
  /** An imperative restatement: what this person does next, in one line. */
  cta: string
  /** Deliberately small for some styles, deliberately whole for others. */
  firstStep: string
  steps: string[]
  timebox: string
  ifStuck: string
  /** Shown so nobody mistakes a generated plan for something that was said aloud. */
  derivedFrom: string
}

const KIND_OBJECT: Record<TaskKind, string> = {
  write: 'the document',
  send: 'the message',
  confirm: 'the answer',
  build: 'the change',
  schedule: 'the invite',
  decide: 'the decision',
  general: 'the task',
}

function firstClause(text: string): string {
  const clause = text.split(/[,;]| so | and then /i)[0].trim()
  return clause.charAt(0).toLowerCase() + clause.slice(1)
}

function ctaFor(item: ActionItem, kind: TaskKind): string {
  const clause = firstClause(item.text)
  const lead: Record<TaskKind, string> = {
    write: 'Draft',
    send: 'Send',
    confirm: 'Confirm',
    build: 'Ship',
    schedule: 'Book',
    decide: 'Decide',
    general: 'Do',
  }
  // The item text already reads as an instruction; prefixing a second verb would be
  // redundant, so the CTA reuses it and only adds a verb when it opens with a noun.
  return /^(write|draft|send|share|confirm|run|build|open|move|book|cut|spec|add|give|pull|change|quarantine)/i.test(
    clause,
  )
    ? capitalise(clause)
    : `${lead[kind]} ${clause}`
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function buildActionPlan(
  item: ActionItem,
  meeting: Meeting,
  style: WorkStyleId,
): ActionPlan {
  const kind = classifyTask(item.text)
  const object = KIND_OBJECT[kind]
  const owner = item.owner ? person(item.owner).name.split(' ')[0] : 'whoever picks this up'
  const due = item.due ? dueLabel(item.due) : 'no date agreed'
  const cta = ctaFor(item, kind)
  const derivedFrom = `Generated from this commitment in ${meeting.title}. Nobody said these steps out loud.`

  switch (style) {
    case 'momentum':
      return {
        cta,
        firstStep: momentumStarter(kind),
        steps: [
          'Set a timer for ten minutes and stop when it goes, finished or not.',
          `Leave ${object} visibly unfinished somewhere you will see it, so returning is easier than restarting.`,
          'Only once it exists, make it good.',
        ],
        timebox: '10 minutes now, not a booked hour later',
        ifStuck: `Make it worse on purpose. Write the bad version of ${object} and send it to one person.`,
        derivedFrom,
      }

    case 'precise':
      return {
        cta,
        firstStep: `Write the one sentence that says ${object} is finished, before starting it.`,
        steps: [
          doneCriteria(kind),
          'List what is explicitly out of scope, so later-you cannot quietly add it.',
          'Do exactly that list. Stop at the last item even if you can see improvements.',
        ],
        timebox: `Decide the budget up front and hold it. ${due}.`,
        ifStuck: 'If you cannot define done, the task is really two tasks. Split it and name both.',
        derivedFrom,
      }

    case 'steady':
      return {
        cta,
        firstStep: steadyStarter(kind, object),
        steps: [
          'Finish that step completely before reading the next one.',
          `Then: ${steadyMiddle(kind, object)}`,
          'Then stop for the day, even if there is time left.',
        ],
        timebox: `${due}. There is room in that; it does not need to happen today.`,
        ifStuck: 'Nothing here needs to happen today. Put it down and pick it up tomorrow.',
        derivedFrom,
      }

    case 'deep':
      return {
        cta,
        firstStep: `Block ninety minutes and gather everything ${object} needs before you start.`,
        steps: [
          'Collect the inputs first: the thread, the data, the previous version. No mid-task lookups.',
          'Notifications off. One pass, start to finish.',
          `Batch anything similar into the same block — ${owner} likely has adjacent items.`,
        ],
        timebox: 'One 90-minute block beats five fragmented attempts',
        ifStuck: 'If you cannot get a clear block this week, this is the item to renegotiate first.',
        derivedFrom,
      }

    case 'collaborative':
      return {
        cta,
        firstStep: collaborativeStarter(kind, meeting, item),
        steps: [
          'Say what you think the answer is before asking what they think. A reaction is easier to give than a blank page.',
          `Take the rough version straight from that conversation into ${object}.`,
          'Send it back to the same person before anyone else sees it.',
        ],
        timebox: 'A 15-minute call now saves the afternoon',
        ifStuck: 'Write the question as if posting it publicly. Half the time you answer it yourself.',
        derivedFrom,
      }
  }
}

function momentumStarter(kind: TaskKind): string {
  switch (kind) {
    case 'write':
      return 'Open a blank document and type the title and three bullet headings. That is the whole first step.'
    case 'send':
      return 'Open the reply window and write the first line. Do not send yet.'
    case 'confirm':
      return 'Write the one question you need answered. Twelve words or fewer.'
    case 'build':
      return 'Open the file you would change first and make one line of the change.'
    case 'schedule':
      return 'Open the calendar and find the slot. Do not invite anyone yet.'
    case 'decide':
      return 'Write the two options side by side in one sentence each.'
    default:
      return 'Do the two-minute version of this badly, right now.'
  }
}

function doneCriteria(kind: TaskKind): string {
  switch (kind) {
    case 'write':
      return 'Define done as a length and an audience: who reads it, and roughly how long it is.'
    case 'send':
      return 'Define done as sent, not as perfect. The reply is the next task, not this one.'
    case 'confirm':
      return 'Define done as a written answer from a named person, not a verbal maybe.'
    case 'build':
      return 'Define done as a test that fails without the change and passes with it.'
    case 'schedule':
      return 'Define done as accepted by every required attendee, not as invites sent.'
    case 'decide':
      return 'Define done as the decision written down somewhere others will find it.'
    default:
      return 'Define done in one sentence someone else could verify.'
  }
}

function steadyStarter(kind: TaskKind, object: string): string {
  return kind === 'write'
    ? 'Read the relevant part of the transcript once. That is today, if that is all there is time for.'
    : `Work out the single smallest piece of ${object} and do only that.`
}

function steadyMiddle(kind: TaskKind, object: string): string {
  return kind === 'confirm' || kind === 'send'
    ? 'write it, and send it without re-reading more than once.'
    : `do the next piece of ${object}.`
}

function collaborativeStarter(kind: TaskKind, meeting: Meeting, item: ActionItem): string {
  const others = meeting.participants.filter((p) => p !== item.owner)
  const partner = others.length > 0 ? person(others[0]).name.split(' ')[0] : 'someone who was there'
  return kind === 'decide'
    ? `Put both options to ${partner} and argue for the one you believe less. The gaps show up fast.`
    : `Ask ${partner} for fifteen minutes and talk it through out loud before writing anything.`
}
