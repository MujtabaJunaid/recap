import {
  createContext,

  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { Highlight, Meeting } from '../data/types'
import { onExternalChange, readJSON, storageKey, writeJSON } from '../lib/storage'

const STATE_VERSION = 1
const KEY = storageKey('workspace', STATE_VERSION)

/**
 * Action item ids are only unique inside their meeting — several meetings have an "a1".
 * Every cross-meeting reference must therefore be qualified, or ticking one meeting's
 * item silently ticks another's.
 */
export function actionKey(meetingId: string, actionId: string): string {
  return `${meetingId}:${actionId}`
}

export interface LocalClip extends Highlight {
  meetingId: string
}

interface WorkspaceState {
  /** Resolved done-state per qualified action key, not a toggle set. See `setActionDone`. */
  actions: Record<string, boolean>
  clips: Record<string, LocalClip>
}

const EMPTY: WorkspaceState = { actions: {}, clips: {} }

type Action =
  | { type: 'action/set'; key: string; done: boolean }
  | { type: 'clip/add'; clip: LocalClip }
  | { type: 'clip/remove'; id: string }
  | { type: 'state/replace'; state: WorkspaceState }

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'action/set': {
      if (state.actions[action.key] === action.done) return state
      return { ...state, actions: { ...state.actions, [action.key]: action.done } }
    }
    case 'clip/add': {
      // Deterministic ids make this an upsert, so double-submitting cannot duplicate.
      if (state.clips[action.clip.id]) return state
      return { ...state, clips: { ...state.clips, [action.clip.id]: action.clip } }
    }
    case 'clip/remove': {
      if (!state.clips[action.id]) return state
      const clips = { ...state.clips }
      delete clips[action.id]
      return { ...state, clips }
    }
    case 'state/replace':
      return action.state
  }
}

function hydrate(raw: unknown): WorkspaceState {
  const value = raw as Partial<WorkspaceState> | null
  return {
    actions: value?.actions && typeof value.actions === 'object' ? value.actions : {},
    clips: value?.clips && typeof value.clips === 'object' ? value.clips : {},
  }
}

interface WorkspaceApi {
  isActionDone: (meeting: Meeting, actionId: string) => boolean
  setActionDone: (meetingId: string, actionId: string, done: boolean) => void
  clipsFor: (meetingId: string) => LocalClip[]
  addClip: (clip: LocalClip) => void
  removeClip: (id: string) => void
  reset: () => void
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY, () => hydrate(readJSON(KEY, EMPTY)))

  useEffect(() => {
    writeJSON(KEY, state)
  }, [state])

  useEffect(
    () =>
      onExternalChange(KEY, (next) => {
        dispatch({ type: 'state/replace', state: hydrate(next ? safeParse(next) : null) })
      }),
    [],
  )

  const api = useMemo<WorkspaceApi>(
    () => ({
      isActionDone: (meeting, actionId) => {
        const override = state.actions[actionKey(meeting.id, actionId)]
        if (override !== undefined) return override
        return Boolean(meeting.actionItems.find((a) => a.id === actionId)?.done)
      },
      setActionDone: (meetingId, actionId, done) =>
        dispatch({ type: 'action/set', key: actionKey(meetingId, actionId), done }),
      clipsFor: (meetingId) =>
        Object.values(state.clips).filter((c) => c.meetingId === meetingId),
      addClip: (clip) => dispatch({ type: 'clip/add', clip }),
      removeClip: (id) => dispatch({ type: 'clip/remove', id }),
      reset: () => dispatch({ type: 'state/replace', state: EMPTY }),
    }),
    [state],
  )

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  return ctx
}

/**
 * Clip ids are derived from their content, so clipping the same window twice produces
 * the same id and the second attempt is a no-op instead of a duplicate row.
 */
export function clipId(meetingId: string, start: number, end: number): string {
  const seed = `${meetingId}:${start}:${end}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `ck-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function useMeetingHighlights(meeting: Meeting): Highlight[] {
  const { clipsFor } = useWorkspace()
  const local = clipsFor(meeting.id)
  return useMemo(
    () =>
      [...meeting.highlights, ...local].sort((a, b) => a.start - b.start),
    // `local` is rebuilt each render by `clipsFor`; compare by identity of its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meeting, local.map((c) => c.id).join()],
  )
}
