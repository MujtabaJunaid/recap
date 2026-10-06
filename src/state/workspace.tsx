import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type { Highlight, Meeting } from '../data/types'
import { DEFAULT_WORK_STYLE, type WorkStyleId } from '../lib/coaching'
import { onExternalChange, readJSON, storageKey, writeJSON } from '../lib/storage'
import { useSession } from './session'
import { debounce } from '../lib/resilience'
import { logger } from '../lib/observability'

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

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
  /** Self-selected, never inferred. See lib/coaching.ts. */
  workStyle: WorkStyleId
  /**
   * Whether this account has any meetings. A new account has recorded nothing, so the
   * honest state is empty; the seeded library is opt-in rather than something another
   * person's meetings get dropped into your workspace.
   */
  hasMeetings: boolean
}

const EMPTY: WorkspaceState = {
  actions: {},
  clips: {},
  workStyle: DEFAULT_WORK_STYLE,
  hasMeetings: false,
}

type Action =
  | { type: 'action/set'; key: string; done: boolean }
  | { type: 'clip/add'; clip: LocalClip }
  | { type: 'clip/remove'; id: string }
  | { type: 'style/set'; style: WorkStyleId }
  | { type: 'sample/load' }
  | { type: 'sample/clear' }
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
    case 'style/set': {
      if (state.workStyle === action.style) return state
      return { ...state, workStyle: action.style }
    }
    case 'sample/load':
      return state.hasMeetings ? state : { ...state, hasMeetings: true }
    case 'sample/clear':
      // Clearing takes the derived state with it; leaving completions behind would
      // resurrect them the next time the sample is loaded.
      return { ...EMPTY, workStyle: state.workStyle }
    case 'state/replace':
      return action.state
  }
}

function hydrate(raw: unknown): WorkspaceState {
  const value = raw as Partial<WorkspaceState> | null
  const styles: WorkStyleId[] = ['momentum', 'precise', 'steady', 'deep', 'collaborative']
  return {
    actions: value?.actions && typeof value.actions === 'object' ? value.actions : {},
    clips: value?.clips && typeof value.clips === 'object' ? value.clips : {},
    workStyle:
      value?.workStyle && styles.includes(value.workStyle)
        ? value.workStyle
        : DEFAULT_WORK_STYLE,
    hasMeetings: value?.hasMeetings === true,
  }
}

interface WorkspaceApi {
  isActionDone: (meeting: Meeting, actionId: string) => boolean
  setActionDone: (meetingId: string, actionId: string, done: boolean) => void
  clipsFor: (meetingId: string) => LocalClip[]
  addClip: (clip: LocalClip) => void
  removeClip: (id: string) => void
  workStyle: WorkStyleId
  setWorkStyle: (style: WorkStyleId) => void
  hasMeetings: boolean
  loadSampleWorkspace: () => void
  clearWorkspace: () => void
  reset: () => void
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY, () => hydrate(readJSON(KEY, EMPTY)))
  const { token, hasAccount } = useSession()

  // Server state is authoritative for a real account, so the first write after sign-in
  // must not race ahead of the load and overwrite it with whatever this browser had.
  const loaded = useRef(false)
  const synced = Boolean(API_BASE && token && hasAccount)

  useEffect(() => {
    writeJSON(KEY, state)
  }, [state])

  useEffect(() => {
    if (!synced) {
      loaded.current = false
      return
    }
    let cancelled = false
    loaded.current = false
    // Abort the request itself on unmount, not just ignore its result. Leaving it in
    // flight means every navigation logs ERR_ABORTED and holds a connection for a
    // response nobody will read.
    const controller = new AbortController()

    fetch(`${API_BASE}/api/state`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`state ${r.status}`))))
      .then((body: { state?: unknown }) => {
        if (cancelled) return
        dispatch({ type: 'state/replace', state: hydrate(body.state) })
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        // A failed load must not silently become a blank workspace that then
        // overwrites the server copy. Stay offline for this session instead.
        logger.warn('workspace.load_failed', {
          errorName: error instanceof Error ? error.name : 'Unknown',
        })
      })
      .finally(() => {
        if (!cancelled) loaded.current = true
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [synced, token])

  const push = useMemo(
    () =>
      debounce((payload: WorkspaceState, bearer: string) => {
        void fetch(`${API_BASE}/api/state`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ state: payload }),
        }).catch(() => {
          // Offline or rejected: the local copy still holds, and the next change retries.
        })
      }, 800),
    [],
  )

  useEffect(() => {
    if (!synced || !loaded.current || !token) return
    push(state, token)
  }, [state, synced, token, push])

  useEffect(() => push.cancel, [push])

  // A save still pending when the tab closes is lost. `sendBeacon` would rescue it but
  // cannot set an Authorization header, so the token would have to go in the URL —
  // where it lands in server logs, referrers and history. An 800ms window of lost
  // state is the better trade; `fetch` with `keepalive` is the fix if it matters.
  useEffect(() => {
    const flush = () => push.cancel()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [push])

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
      workStyle: state.workStyle,
      setWorkStyle: (style) => dispatch({ type: 'style/set', style }),
      hasMeetings: state.hasMeetings,
      loadSampleWorkspace: () => dispatch({ type: 'sample/load' }),
      clearWorkspace: () => dispatch({ type: 'sample/clear' }),
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
