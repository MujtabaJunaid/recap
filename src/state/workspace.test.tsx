import { describe, expect, it } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceProvider, actionKey, clipId, useWorkspace } from './workspace'
import { SessionProvider } from './session'
import { getMeeting } from '../data'
import { ActionItems } from '../components/Panels'

// WorkspaceProvider reads the session to decide whether to sync to the server, so it
// has to be mounted inside one. Signed out, it stays on the local path.
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </SessionProvider>
  )
}

const roadmap = getMeeting('q3-roadmap-review')!
const acme = getMeeting('acme-discovery')!

describe('action keys', () => {
  it('qualifies by meeting, because action ids repeat across meetings', () => {
    // Both meetings genuinely ship an "a1"; an unqualified key would collide.
    expect(roadmap.actionItems.some((a) => a.id === 'a1')).toBe(true)
    expect(acme.actionItems.some((a) => a.id === 'a1')).toBe(true)
    expect(actionKey(roadmap.id, 'a1')).not.toBe(actionKey(acme.id, 'a1'))
  })

  it('an override on one meeting leaves the same id in another on its seed value', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    const acmeSeed = Boolean(acme.actionItems.find((a) => a.id === 'a1')!.done)

    act(() => result.current.setActionDone(roadmap.id, 'a1', true))

    expect(result.current.isActionDone(roadmap, 'a1')).toBe(true)
    expect(result.current.isActionDone(acme, 'a1')).toBe(acmeSeed)
  })

  it('isolates in the other direction too', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })

    act(() => result.current.setActionDone(roadmap.id, 'a1', true))
    act(() => result.current.setActionDone(acme.id, 'a1', false))

    expect(result.current.isActionDone(roadmap, 'a1')).toBe(true)
    expect(result.current.isActionDone(acme, 'a1')).toBe(false)
  })
})

describe('action completion is idempotent', () => {
  it('applying the same value twice is a no-op, not a toggle', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })

    act(() => result.current.setActionDone(roadmap.id, 'a2', true))
    act(() => result.current.setActionDone(roadmap.id, 'a2', true))

    expect(result.current.isActionDone(roadmap, 'a2')).toBe(true)
  })

  it('falls back to the seed value when there is no override', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    const seeded = roadmap.actionItems.find((a) => a.done)!

    expect(result.current.isActionDone(roadmap, seeded.id)).toBe(true)
  })

  it('an override can reopen a seeded-complete item', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    const seeded = roadmap.actionItems.find((a) => a.done)!

    act(() => result.current.setActionDone(roadmap.id, seeded.id, false))

    expect(result.current.isActionDone(roadmap, seeded.id)).toBe(false)
  })
})

describe('clips', () => {
  it('derives the same id for the same window, so re-clipping cannot duplicate', () => {
    expect(clipId('m', 10, 40)).toBe(clipId('m', 10, 40))
    expect(clipId('m', 10, 40)).not.toBe(clipId('m', 10, 41))
    expect(clipId('m', 10, 40)).not.toBe(clipId('other', 10, 40))
  })

  it('adding the same clip twice stores one', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    const clip = {
      id: clipId(roadmap.id, 100, 140),
      meetingId: roadmap.id,
      title: 'A moment',
      start: 100,
      end: 140,
      createdBy: 'priya',
    }

    act(() => result.current.addClip(clip))
    act(() => result.current.addClip({ ...clip, title: 'Different title, same window' }))

    expect(result.current.clipsFor(roadmap.id)).toHaveLength(1)
  })

  it('scopes clips to their meeting', () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper })

    act(() =>
      result.current.addClip({
        id: clipId(roadmap.id, 5, 30),
        meetingId: roadmap.id,
        title: 'x',
        start: 5,
        end: 30,
        createdBy: 'priya',
      }),
    )

    expect(result.current.clipsFor(roadmap.id)).toHaveLength(1)
    expect(result.current.clipsFor(acme.id)).toHaveLength(0)
  })
})

describe('persistence', () => {
  it('survives a remount', () => {
    const first = renderHook(() => useWorkspace(), { wrapper })
    act(() => first.result.current.setActionDone(roadmap.id, 'a3', true))
    first.unmount()

    const second = renderHook(() => useWorkspace(), { wrapper })
    expect(second.result.current.isActionDone(roadmap, 'a3')).toBe(true)
  })

  it('ignores corrupt stored state instead of crashing', () => {
    window.localStorage.setItem('recap:workspace:v1', '{not json')

    const { result } = renderHook(() => useWorkspace(), { wrapper })
    expect(result.current.clipsFor(roadmap.id)).toHaveLength(0)
  })
})

describe('action items in the UI', () => {
  it('ticking an item moves it from Open to Done', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SessionProvider>
          <WorkspaceProvider>
            <ActionItems meeting={acme} onSeek={() => {}} />
          </WorkspaceProvider>
        </SessionProvider>
      </MemoryRouter>,
    )

    // Signed out, so the control is present but not operable.
    const checkbox = screen.getAllByRole('button', { name: /^Complete:/ })[0]
    expect(checkbox).toBeDisabled()

    await user.click(checkbox)
    expect(checkbox).toBeInTheDocument()
  })
})
