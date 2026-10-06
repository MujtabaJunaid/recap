import type { ReactNode } from 'react'
import { avatarColor, initials, person } from '../data/people'
import type { Platform } from '../data/types'

const SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
}

export function Avatar({
  id,
  size = 'sm',
  ring = false,
}: {
  id: string
  size?: keyof typeof SIZES
  ring?: boolean
}) {
  const p = person(id)
  return (
    <span
      title={`${p.name}${p.title ? ` — ${p.title}` : ''}`}
      className={`${SIZES[size]} ${avatarColor(id)} inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        ring ? 'ring-2 ring-ink-900' : ''
      }`}
    >
      {initials(id)}
    </span>
  )
}

export function AvatarStack({ ids, max = 5 }: { ids: string[]; max?: number }) {
  const shown = ids.slice(0, max)
  const rest = ids.length - shown.length
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((id) => (
        <Avatar key={id} id={id} size="xs" ring />
      ))}
      {rest > 0 && (
        <span className="inline-flex h-5 items-center rounded-full bg-ink-700 px-1.5 text-[9px] font-semibold text-ink-300 ring-2 ring-ink-900">
          +{rest}
        </span>
      )}
    </div>
  )
}

const PLATFORM_LABEL: Record<Platform, string> = {
  zoom: 'Zoom',
  meet: 'Google Meet',
  teams: 'Teams',
}

const PLATFORM_COLOR: Record<Platform, string> = {
  zoom: 'text-sky-400',
  meet: 'text-emerald-400',
  teams: 'text-indigo-400',
}

export function PlatformTag({ platform }: { platform: Platform }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${PLATFORM_COLOR[platform]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {PLATFORM_LABEL[platform]}
    </span>
  )
}

export function Pill({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'warn' | 'good' | 'brand'
}) {
  const tones = {
    default: 'bg-ink-800 text-ink-300 ring-ink-700',
    warn: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
    good: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
    brand: 'bg-brand-500/15 text-brand-400 ring-brand-500/30',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Icon({ path, className = 'h-4 w-4' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  )
}

export const ICONS = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M9 5v14M15 5v14',
  back: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  forward: 'M13 7l5 5-5 5M6 7l5 5-5 5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  scissors: 'M6 4l12 12M18 4L6 16M8 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM21 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  check: 'M4 12.5l5 5L20 6.5',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
  calendar: 'M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  video: 'M15 10l5-3v10l-5-3v-4zM3 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      <p className="mt-1 text-xs text-ink-400">{detail}</p>
    </div>
  )
}
