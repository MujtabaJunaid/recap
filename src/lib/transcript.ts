import type { Meeting } from '../data/types'

/** Index of the last transcript line that has started at `time`, or -1 before the first. */
export function findActive(meeting: Meeting, time: number): number {
  let active = -1
  for (let i = 0; i < meeting.transcript.length; i++) {
    if (meeting.transcript[i].t <= time) active = i
    else break
  }
  return active
}
