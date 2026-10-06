import { describe, expect, it } from 'vitest'
import {
  buildActionPlan,
  classifyTask,
  DEFAULT_WORK_STYLE,
  WORK_STYLES,
  type WorkStyleId,
} from './coaching'
import {
  ACTION_PLAN_SCHEMA,
  buildUserMessage,
  excerptAround,
  InvalidPlanError,
  parseActionPlan,
  SYSTEM_PROMPT,
  toAnthropicTool,
  toGeminiTool,
  toOpenAITool,
} from './prompts'
import { getMeeting } from '../data'

const meeting = getMeeting('q3-roadmap-review')!
const spike = meeting.actionItems.find((a) => a.id === 'a1')!
const styles = WORK_STYLES.map((s) => s.id)

describe('task classification', () => {
  it('reads the leading verb', () => {
    expect(classifyTask('Write the incremental path as a one-pager')).toBe('write')
    expect(classifyTask('Send the SOC 2 report to Devon')).toBe('send')
    expect(classifyTask('Confirm the date with Northwind in writing')).toBe('confirm')
    expect(classifyTask('Run a two-week bounded spike')).toBe('build')
    expect(classifyTask('Move the platform sync to 30 minutes')).toBe('schedule')
    expect(classifyTask('Open the req for one senior data engineer')).toBe('decide')
  })

  it('falls back rather than guessing', () => {
    expect(classifyTask('Northwind')).toBe('general')
  })
})

describe('action plans', () => {
  it('produces a complete plan for every work style', () => {
    for (const style of styles) {
      const plan = buildActionPlan(spike, meeting, style)
      expect(plan.cta.length).toBeGreaterThan(0)
      expect(plan.firstStep.length).toBeGreaterThan(0)
      expect(plan.steps.length).toBeGreaterThanOrEqual(2)
      expect(plan.steps.length).toBeLessThanOrEqual(4)
      expect(plan.timebox.length).toBeGreaterThan(0)
      expect(plan.ifStuck.length).toBeGreaterThan(0)
    }
  })

  it('gives genuinely different advice per style, not one text reskinned', () => {
    const firstSteps = styles.map((s) => buildActionPlan(spike, meeting, s).firstStep)
    expect(new Set(firstSteps).size).toBe(styles.length)
  })

  it('is deterministic, so the plan does not change under the reader', () => {
    expect(buildActionPlan(spike, meeting, 'momentum')).toEqual(
      buildActionPlan(spike, meeting, 'momentum'),
    )
  })

  it('always says the steps were generated, never implied as spoken', () => {
    for (const style of styles) {
      expect(buildActionPlan(spike, meeting, style).derivedFrom).toMatch(/nobody said/i)
    }
  })

  it('sizes the momentum first step small and decision-free', () => {
    const plan = buildActionPlan(spike, meeting, 'momentum')
    expect(plan.firstStep.toLowerCase()).toMatch(/open|write|type|do the two-minute/)
    expect(plan.timebox).toMatch(/10 minutes/)
  })

  it('gives the precise style a stop condition, which is its whole point', () => {
    const plan = buildActionPlan(spike, meeting, 'precise')
    expect(plan.firstStep.toLowerCase()).toContain('finished')
    expect(plan.steps.join(' ').toLowerCase()).toMatch(/out of scope|stop at/)
  })

  it('keeps the steady style free of urgency language', () => {
    const plan = buildActionPlan(spike, meeting, 'steady')
    const all = [plan.cta, plan.firstStep, ...plan.steps, plan.timebox, plan.ifStuck].join(' ')
    expect(all).not.toMatch(/!|urgent|asap|immediately|right now/i)
  })

  it('names a real participant for the collaborative style', () => {
    const plan = buildActionPlan(spike, meeting, 'collaborative')
    const names = meeting.participants.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    expect(names.some((n) => plan.firstStep.includes(n))).toBe(true)
  })

  it('handles an unassigned item without producing "undefined"', () => {
    const orphan = { ...spike, owner: null }
    for (const style of styles) {
      const plan = buildActionPlan(orphan, meeting, style)
      const all = [plan.cta, plan.firstStep, ...plan.steps, plan.ifStuck].join(' ')
      expect(all).not.toMatch(/undefined|null|NaN/)
    }
  })

  it('handles an item with no due date', () => {
    const undated = { ...spike, due: undefined }
    const plan = buildActionPlan(undated, meeting, 'steady')
    expect(plan.timebox).not.toMatch(/undefined|NaN/)
  })

  it('exports a default style that exists', () => {
    expect(styles).toContain(DEFAULT_WORK_STYLE as WorkStyleId)
  })
})

describe('the hosted contract', () => {
  it('forbids invention and requires the tool call', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never invent/)
    expect(SYSTEM_PROMPT).toMatch(/needs_clarification/)
    expect(SYSTEM_PROMPT).toContain('emit_action_plan')
  })

  it('tells the model not to diagnose, because these are self-chosen preferences', () => {
    expect(SYSTEM_PROMPT).toMatch(/not clinical categories|do not diagnose/i)
  })

  it('exposes the same schema to every provider', () => {
    expect(toAnthropicTool().input_schema).toBe(ACTION_PLAN_SCHEMA)
    expect(toOpenAITool().function.parameters).toBe(ACTION_PLAN_SCHEMA)
    expect(toGeminiTool().functionDeclarations[0].parameters).toBe(ACTION_PLAN_SCHEMA)
    expect(toOpenAITool().function.name).toBe(toAnthropicTool().name)
  })

  it('sends only the excerpt, never the whole transcript', () => {
    const message = buildUserMessage({
      actionText: spike.text,
      ownerName: 'Daniel',
      due: '2026-10-13',
      meetingTitle: meeting.title,
      transcriptExcerpt: excerptAround(meeting.transcript, spike.t),
      style: 'momentum',
    })
    expect(message.length).toBeLessThan(2500)
    expect(message).toContain('WORK STYLE: momentum')
  })

  it('bounds the excerpt on both sides of the commitment', () => {
    const excerpt = excerptAround(meeting.transcript, spike.t)
    expect(excerpt.split('\n').length).toBeLessThanOrEqual(12)
    expect(excerpt.length).toBeGreaterThan(0)
  })
})

describe('model output is untrusted', () => {
  const good = {
    cta: 'Run the two-week spike',
    first_step: 'Open the dataset.',
    steps: ['One.', 'Two.'],
    timebox: '10 minutes',
    if_stuck: 'Ask Aisha.',
    needs_clarification: false,
  }

  it('accepts a well-formed tool call', () => {
    const { plan } = parseActionPlan(good, 'from a test')
    expect(plan?.cta).toBe('Run the two-week spike')
    expect(plan?.steps).toHaveLength(2)
  })

  it('rejects a missing field rather than rendering a half plan', () => {
    expect(() => parseActionPlan({ ...good, if_stuck: '' }, 'x')).toThrow(InvalidPlanError)
    expect(() => parseActionPlan({ ...good, cta: undefined }, 'x')).toThrow(InvalidPlanError)
  })

  it('rejects a step list outside the allowed range', () => {
    expect(() => parseActionPlan({ ...good, steps: ['only one'] }, 'x')).toThrow(InvalidPlanError)
    expect(() => parseActionPlan({ ...good, steps: ['a', 'b', 'c', 'd', 'e'] }, 'x')).toThrow(
      InvalidPlanError,
    )
  })

  it('rejects an over-long cta', () => {
    expect(() => parseActionPlan({ ...good, cta: 'x'.repeat(200) }, 'x')).toThrow(InvalidPlanError)
  })

  it('rejects non-objects and nulls', () => {
    expect(() => parseActionPlan(null, 'x')).toThrow(InvalidPlanError)
    expect(() => parseActionPlan('a string', 'x')).toThrow(InvalidPlanError)
  })

  it('surfaces a clarifying question instead of a guessed plan', () => {
    const { plan, clarifyingQuestion } = parseActionPlan(
      { ...good, needs_clarification: true, clarifying_question: 'Which dataset?' },
      'x',
    )
    expect(plan).toBeNull()
    expect(clarifyingQuestion).toBe('Which dataset?')
  })

  it('rejects a vagueness flag with no question attached', () => {
    expect(() => parseActionPlan({ ...good, needs_clarification: true }, 'x')).toThrow(
      InvalidPlanError,
    )
  })
})
