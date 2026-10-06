import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drives a playhead without a media element. The capture and storage layers are
 * stubbed in this build, so playback is a wall-clock simulation over the transcript
 * timeline; every consumer of a real <video> currentTime works unchanged against it.
 */
export function usePlayback(durationSec: number, floorSec = 0) {
  const [time, setTime] = useState(floorSec)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const frame = useRef<number | undefined>(undefined)
  const last = useRef<number>(0)

  useEffect(() => {
    if (!playing) return

    last.current = performance.now()
    const tick = (now: number) => {
      const delta = ((now - last.current) / 1000) * rate
      last.current = now
      setTime((prev) => {
        const next = prev + delta
        if (next >= durationSec) {
          setPlaying(false)
          return durationSec
        }
        return next
      })
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [playing, rate, durationSec])

  const seek = useCallback(
    (to: number) => setTime(Math.max(floorSec, Math.min(durationSec, to))),
    [durationSec, floorSec],
  )

  const toggle = useCallback(() => {
    setPlaying((p) => {
      // Replaying a finished clip restarts at the window start, not at zero.
      if (!p && time >= durationSec) setTime(floorSec)
      return !p
    })
  }, [time, durationSec, floorSec])

  const skip = useCallback((by: number) => seek(time + by), [seek, time])

  const play = useCallback(
    (from?: number) => {
      if (from !== undefined) seek(from)
      setPlaying(true)
    },
    [seek],
  )

  return { time, playing, rate, seek, toggle, skip, play, setRate, setPlaying }
}

export type Playback = ReturnType<typeof usePlayback>
