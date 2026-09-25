import type { Patient, WatchStatus } from '../types.ts'

/** ClinVar review status → gold stars (0–4), per ClinVar's documented mapping. */
export function reviewStars(status: string): number {
  const s = status.toLowerCase()
  if (s.includes('practice guideline')) return 4
  if (s.includes('expert panel')) return 3
  if (s.includes('multiple submitters, no conflicts')) return 2
  if (s.startsWith('criteria provided')) return 1
  return 0
}

/** Short display name for a classification ("Conflicting classifications of pathogenicity" → "Conflicting"). */
export function shortClass(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('conflicting')) return 'Conflicting'
  if (d.startsWith('uncertain significance')) return 'VUS'
  if (d.startsWith('pathogenic/likely pathogenic')) return 'P/LP'
  if (d.startsWith('pathogenic')) return 'Pathogenic'
  if (d.startsWith('likely pathogenic')) return 'Likely pathogenic'
  if (d.startsWith('benign/likely benign')) return 'B/LB'
  if (d.startsWith('likely benign')) return 'Likely benign'
  if (d.startsWith('benign')) return 'Benign'
  return desc
}

/** "NM_…(GENE):c.1152C>A (p.Ser384Arg)" → { c: "c.1152C>A", p: "p.Ser384Arg" } */
export function shortVariant(hgvs: string): { c: string; p: string | null } {
  const c = /:(c\.[^\s]+)/.exec(hgvs)?.[1] ?? hgvs
  const p = /\((p\.[^)]+)\)\s*$/.exec(hgvs)?.[1] ?? null
  return { c, p }
}

export const WATCH_LABEL: Record<WatchStatus, string> = {
  active: 'Active',
  waiting_on_gc: 'Waiting on GC',
  letter_drafted: 'Letter drafted',
  quiet: 'Quiet',
  closed: 'Closed',
}

/** Most urgent first. */
export const WATCH_ORDER: WatchStatus[] = ['waiting_on_gc', 'letter_drafted', 'active', 'quiet', 'closed']

/** A case's status is its most urgent variant's status; null when there is nothing to watch. */
export function caseStatus(p: Patient): WatchStatus | null {
  if (!p.variants.length) return null
  return WATCH_ORDER.find((s) => p.variants.some((v) => v.watch_status === s)) ?? null
}

/** Statuses the worklist counts as waiting on the GC ("Waiting on me" + "Letters to approve"). */
export const isAwaitingGc = (s: WatchStatus) => s === 'waiting_on_gc' || s === 'letter_drafted'

export const isUrgent = (p: Patient) => p.variants.some((v) => v.decision?.urgent && v.watch_status === 'waiting_on_gc')

export const isChanged = (p: Patient) => p.variants.some((v) => v.classification_changed)

export const hasVus = (p: Patient) =>
  p.variants.some((v) => v.reported_classification.classification === 'Uncertain significance')

export function fmtDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${m}/${d}/${y}`
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
