import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drives a playhead without a media element. The capture and storage layers are stubbed
 * in this build, so playback is a wall-clock simulation over the transcript timeline;
 * every consumer is written against `currentTime` semantics and works unchanged against
 * a real <video>.
 *
 * `floorSec` bounds the window from below, so a clip player replays from the clip start
 * rather than from zero.
 */
export function usePlayback(durationSec: number, floorSec = 0) {
  const [time, setTime] = useState(floorSec)
  // User intent. Whether the clock is actually running is derived below, so reaching the
  // end needs no state update and no effect to undo one.
  const [requested, setRequested] = useState(false)

  const [rate, setRate] = useState(1)
  const frame = useRef<number | undefined>(undefined)
  const last = useRef(0)

  const atEnd = time >= durationSec
  const playing = requested && !atEnd

  const clamp = useCallback(
    (to: number) => Math.max(floorSec, Math.min(durationSec, to)),
    [floorSec, durationSec],
  )

  useEffect(() => {
    if (!playing) return

    last.current = performance.now()
    const tick = (now: number) => {
      const delta = ((now - last.current) / 1000) * rate
      last.current = now
      // Pure updater: clamping is the only rule, and the loop unmounts itself via
      // `playing` turning false once `time` reaches the end.
      setTime((prev) => Math.min(durationSec, prev + delta))
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      frame.current = undefined
    }
  }, [playing, rate, durationSec])

  const seek = useCallback((to: number) => setTime(clamp(to)), [clamp])

  const skip = useCallback((by: number) => setTime((prev) => clamp(prev + by)), [clamp])

  const play = useCallback(
    (from?: number) => {
      if (from !== undefined) setTime(clamp(from))
      else setTime((prev) => (prev >= durationSec ? floorSec : prev))
      setRequested(true)
    },
    [clamp, durationSec, floorSec],
  )

  const pause = useCallback(() => setRequested(false), [])

  const toggle = useCallback(() => {
    if (playing) setRequested(false)
    else play()
  }, [playing, play])

  return { time, playing, rate, seek, skip, play, pause, toggle, setRate }
}

export type Playback = ReturnType<typeof usePlayback>
