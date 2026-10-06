export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, '0')}`
    : `${mm}:${String(sec).padStart(2, '0')}`
}

export function durationLabel(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} hr` : `${h} hr ${rest} min`
}

const DAY = 86_400_000

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(d)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function dueLabel(iso: string, now = new Date()): string {
  const d = new Date(`${iso}T00:00:00`)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(d) - startOf(now)) / DAY)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff < 7) return `Due in ${diff}d`
  return `Due ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}
