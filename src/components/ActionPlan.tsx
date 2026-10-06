import { useEffect, useState } from 'react'
import type { ActionItem, Meeting } from '../data/types'
import { WORK_STYLES, type WorkStyleId } from '../lib/coaching'
import { getActionPlan, isHostedPlanningEnabled, type PlanResult } from '../lib/planClient'
import { useWorkspace } from '../state/workspace'
import { useSession } from '../state/session'
import { Icon, ICONS, Pill } from './primitives'

/**
 * The plan is collapsed by default. Someone scanning their commitments does not want
 * five expanded coaching panels; someone who is stuck on one wants it on that one.
 */
export function ActionPlanPanel({ item, meeting }: { item: ActionItem; meeting: Meeting }) {
  const { workStyle } = useWorkspace()
  const { token } = useSession()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<PlanResult | null>(null)
  const [loading, setLoading] = useState(false)

  // Only fetch once the panel is actually opened: generating a plan for every action
  // item on the page would be slow and, with a hosted model, expensive.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    getActionPlan(item, meeting, workStyle, token)
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, item, meeting, workStyle, token])

  const plan = result?.plan

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-brand-400 transition-colors hover:bg-brand-500/10"
      >
        <Icon path={ICONS.sparkle} className="h-3 w-3" />
        {open ? 'Hide plan' : 'How to start this'}
      </button>

      {open && !plan && (
        <p className="mt-1.5 text-[12px] text-ink-400">
          {loading ? 'Working out how to start this…' : 'No plan available.'}
        </p>
      )}

      {open && plan && (
        <div className="rise mt-1.5 rounded-lg border border-brand-500/20 bg-brand-500/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-[13px] font-medium leading-snug text-white">{plan.cta}</p>
            {isHostedPlanningEnabled && (
              <Pill tone={result?.source === 'model' ? 'brand' : 'default'}>
                {result?.source === 'model' ? 'AI' : 'offline planner'}
              </Pill>
            )}
          </div>

          {result?.clarifyingQuestion && (
            <p className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-2 text-[12px] leading-snug text-amber-200">
              This commitment is ambiguous as recorded. Worth asking:{' '}
              <span className="font-medium">{result.clarifyingQuestion}</span>
            </p>
          )}

          {result?.degraded && (
            <p className="mt-1.5 text-[11px] text-ink-400">
              Could not reach the planner, so this is the built-in version.
            </p>
          )}

          <div className="mt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400">
              Start here
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-200">{plan.firstStep}</p>
          </div>

          <ol className="mt-2.5 space-y-1">
            {plan.steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-300">
                <span className="mt-px font-mono text-[10px] text-ink-500">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-800 pt-2.5">
            <p className="text-[11px] text-ink-400">
              <span className="text-ink-300">Time:</span> {plan.timebox}
            </p>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-400">
            <span className="text-ink-300">Stuck:</span> {plan.ifStuck}
          </p>

          <p className="mt-2 text-[10px] leading-snug text-ink-500">{plan.derivedFrom}</p>
        </div>
      )}
    </div>
  )
}

/**
 * The style is chosen by the person, never inferred. The copy says so, because an app
 * guessing at how someone's attention works would be both wrong and unwelcome.
 */
export function WorkStylePicker({ compact = false }: { compact?: boolean }) {
  const { workStyle, setWorkStyle } = useWorkspace()
  const [expanded, setExpanded] = useState(false)
  const current = WORK_STYLES.find((s) => s.id === workStyle)

  if (compact) {
    return (
      <label className="flex items-center gap-1.5 text-[11px] text-ink-400">
        <span className="whitespace-nowrap">Plans for:</span>
        <select
          value={workStyle}
          onChange={(e) => setWorkStyle(e.target.value as WorkStyleId)}
          aria-label="How you work best"
          className="max-w-[11rem] rounded-md border border-ink-700 bg-ink-950 px-1.5 py-1 text-[11px] text-ink-200 outline-none focus:border-brand-500/60"
        >
          {WORK_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-white">How you work best</h2>
          <p className="mt-0.5 text-[12px] text-ink-400">
            You choose this; nothing is inferred about you. It changes how plans are shaped,
            never what the task is.
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-[11px] text-brand-400 hover:underline"
        >
          {expanded ? 'Collapse' : 'Change'}
        </button>
      </div>

      {!expanded && current && (
        <p className="mt-2 text-[12px] text-ink-300">
          <span className="font-medium text-ink-200">{current.label}</span> — {current.blurb}
        </p>
      )}

      {expanded && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {WORK_STYLES.map((style) => {
            const active = style.id === workStyle
            return (
              <button
                key={style.id}
                onClick={() => setWorkStyle(style.id)}
                aria-pressed={active}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-brand-500/50 bg-brand-500/10'
                    : 'border-ink-800 hover:border-ink-600 hover:bg-ink-850'
                }`}
              >
                <span
                  className={`block text-[12px] font-medium ${active ? 'text-white' : 'text-ink-200'}`}
                >
                  {style.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-400">
                  {style.blurb}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
