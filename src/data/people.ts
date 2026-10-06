import type { Person } from './types'

export const PEOPLE: Person[] = [
  { id: 'priya', name: 'Priya Raman', title: 'VP Product', org: 'Northbeam' },
  { id: 'daniel', name: 'Daniel Okafor', title: 'Staff Engineer', org: 'Northbeam' },
  { id: 'marta', name: 'Marta Lindqvist', title: 'Head of Design', org: 'Northbeam' },
  { id: 'james', name: 'James Whitfield', title: 'Eng Manager, Platform', org: 'Northbeam' },
  { id: 'aisha', name: 'Aisha Bello', title: 'Data Lead', org: 'Northbeam' },
  { id: 'tom', name: 'Tom Reyes', title: 'Account Executive', org: 'Northbeam' },
  { id: 'sofia', name: 'Sofia Marchetti', title: 'Customer Success Manager', org: 'Northbeam' },
  { id: 'kenji', name: 'Kenji Watanabe', title: 'CTO', org: 'Northbeam' },
  { id: 'rachel', name: 'Rachel Donovan', title: 'Support Engineer', org: 'Northbeam' },
  { id: 'luis', name: 'Luis Ferreira', title: 'Backend Engineer', org: 'Northbeam' },
  { id: 'hannah', name: 'Hannah Pryce', title: 'Director of Ops', org: 'Acme Logistics', external: true },
  { id: 'devon', name: 'Devon Clarke', title: 'IT Manager', org: 'Acme Logistics', external: true },
  { id: 'nadia', name: 'Nadia Haddad', title: 'VP Engineering', org: 'Northwind Freight', external: true },
  { id: 'greg', name: 'Greg Salter', title: 'Procurement', org: 'Northwind Freight', external: true },
  { id: 'elena', name: 'Elena Vasquez', title: 'Candidate', org: 'Independent', external: true },
]

export const ME = 'priya'

const BY_ID = new Map(PEOPLE.map((p) => [p.id, p]))

const UNKNOWN: Person = { id: 'unknown', name: 'Unknown speaker', title: '', org: '' }

export function person(id: string): Person {
  return BY_ID.get(id) ?? UNKNOWN
}

export function initials(id: string): string {
  const name = person(id).name
  const parts = name.split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const PALETTE = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-fuchsia-500',
  'bg-lime-600',
]

export function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}
