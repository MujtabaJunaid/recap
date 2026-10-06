import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MEETINGS } from '../data'
import { PEOPLE, person } from '../data/people'
import { Avatar, Icon, ICONS, Pill } from '../components/primitives'
import { dueLabel, isOverdue, relativeDay, timecode } from '../lib/format'
import type { ActionItem, Meeting } from '../data/types'
import { useWorkspace } from '../state/workspace'
import { useSession } from '../state/session'

interface Row {
  item: ActionItem
  meeting: Meeting
}

const UNDATED = '9999-99-99'

export function Actions() {
  const [owner, setOwner] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const { isActionDone, setActionDone } = useWorkspace()
  const { can } = useSession()
  const editable = can('workspace:write')

  // Evaluated once per mount so every row in a render agrees on "today".
  const now = useMemo(() => new Date(), [])

  const rows: Row[] = useMemo(
    () =>
      MEETINGS.flatMap((meeting) => meeting.actionItems.map((item) => ({ item, meeting }))).sort(
        (a, b) => (a.item.due ?? UNDATED).localeCompare(b.item.due ?? UNDATED),
      ),
    [],
  )

  const owners = useMemo(() => {
    const ids = new Set(rows.map((r) => r.item.owner).filter(Boolean) as string[])
    return PEOPLE.filter((p) => ids.has(p.id))
  }, [rows])

  const done = (row: Row) => isActionDone(row.meeting, row.item.id)

  const visible = rows
    .filter((r) => owner === 'all' || r.item.owner === owner)
    .filter((r) => showDone || !done(r))

  const openCount = rows.filter((r) => !done(r)).length
  const overdueCount = rows.filter(
    (r) => !done(r) && r.item.due && isOverdue(r.item.due, now),
  ).length

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 md:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Action items</h1>
      <p className="mt-1 text-sm text-ink-400">
        {openCount} open across {MEETINGS.filter((m) => m.actionItems.length > 0).length} meetings
        {overdueCount > 0 && <span className="text-amber-300"> · {overdueCount} overdue</span>}.
        Every one links back to the second it was committed to.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="owner-filter">
          Filter by owner
        </label>
        <select
          id="owner-filter"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2 text-[13px] text-ink-200 outline-none focus:border-brand-500/60"
        >
          <option value="all">Everyone</option>
          {owners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-300">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Show completed
        </label>
      </div>

      <div className="mt-4 space-y-1.5">
        {visible.map((row) => {
          const { item, meeting } = row
          const complete = done(row)
          return (
            <div
              key={`${meeting.id}:${item.id}`}
              className={`rise flex gap-3 rounded-xl border border-ink-800 bg-ink-900 p-3.5 ${
                complete ? 'opacity-55' : ''
              }`}
            >
              <button
                onClick={() => setActionDone(meeting.id, item.id, !complete)}
                disabled={!editable}
                aria-pressed={complete}
                aria-label={complete ? `Reopen: ${item.text}` : `Complete: ${item.text}`}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  complete
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-ink-600 enabled:hover:border-brand-500'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {complete && <Icon path={ICONS.check} className="h-3 w-3" />}
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] leading-relaxed ${
                    complete ? 'text-ink-400 line-through' : 'text-ink-200'
                  }`}
                >
                  {item.text}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {item.owner ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
                      <Avatar id={item.owner} size="xs" />
                      {person(item.owner).name}
                    </span>
                  ) : (
                    <Pill tone="warn">Unassigned</Pill>
                  )}
                  {item.due && !complete && (
                    <Pill tone={isOverdue(item.due, now) ? 'warn' : 'default'}>
                      {dueLabel(item.due, now)}
                    </Pill>
                  )}
                  <Link
                    to={`/m/${meeting.id}?t=${Math.max(0, item.t - 5)}`}
                    className="inline-flex items-center gap-1 text-[11px] text-ink-400 transition-colors hover:text-brand-400"
                  >
                    <Icon path={ICONS.play} className="h-2.5 w-2.5 fill-current" />
                    {meeting.title}
                    <span className="font-mono tabular-nums">{timecode(item.t)}</span>
                  </Link>
                  <span className="text-[11px] text-ink-600">{relativeDay(meeting.date)}</span>
                </div>
              </div>
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-200">Nothing open here.</p>
            <p className="mt-1 text-xs text-ink-400">Switch the filter or show completed items.</p>
          </div>
        )}
      </div>
    </div>
  )
}
