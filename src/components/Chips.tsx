import type { DecisionAction, TrustTier, TrustUsed, WatchStatus } from '../types'
import { WATCH_LABEL, shortClass } from '../lib/clinical'

const WATCH_STYLE: Record<WatchStatus, string> = {
  active: 'bg-amber-50 text-amber-800 ring-amber-300',
  waiting_on_gc: 'bg-rose-50 text-rose-800 ring-rose-300',
  letter_drafted: 'bg-indigo-50 text-indigo-800 ring-indigo-300',
  quiet: 'bg-slate-50 text-slate-600 ring-slate-300',
  closed: 'bg-slate-100 text-slate-500 ring-slate-300',
}

export function WatchChip({ status }: { status: WatchStatus | null }) {
  if (!status) return <span className="text-slate-400">—</span>
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${WATCH_STYLE[status]}`}>
      {WATCH_LABEL[status]}
    </span>
  )
}

function classStyle(short: string): string {
  if (short === 'Pathogenic' || short === 'P/LP') return 'text-red-800 bg-red-50 ring-red-200'
  if (short === 'Likely pathogenic') return 'text-orange-800 bg-orange-50 ring-orange-200'
  if (short === 'Conflicting') return 'text-purple-800 bg-purple-50 ring-purple-200'
  if (short === 'VUS') return 'text-sky-800 bg-sky-50 ring-sky-200'
  if (short.includes('enign') || short === 'B/LB') return 'text-emerald-800 bg-emerald-50 ring-emerald-200'
  return 'text-slate-700 bg-slate-50 ring-slate-200'
}

export function ClassBadge({ desc, title }: { desc: string; title?: string }) {
  const short = shortClass(desc)
  return (
    <span
      title={title ?? desc}
      className={`inline-block whitespace-nowrap rounded px-1 py-px text-[11px] font-medium ring-1 ring-inset ${classStyle(short)}`}
    >
      {short}
    </span>
  )
}

/** ClinVar review stars, deliberately small and gray: counselors decide on lab trust, not stars. */
export function Stars({ n, title }: { n: number; title?: string }) {
  return (
    <span title={title} className="whitespace-nowrap text-[9px] tracking-tight" aria-label={`${n} of 4 review stars`}>
      <span className="text-slate-400">{'★'.repeat(n)}</span>
      <span className="text-slate-200">{'★'.repeat(4 - n)}</span>
    </span>
  )
}

const ACTION_STYLE: Record<DecisionAction, string> = {
  flag_upgrade: 'bg-red-600 text-white ring-red-700',
  flag_downgrade: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  hold: 'bg-amber-50 text-amber-800 ring-amber-300',
  recheck: 'bg-slate-100 text-slate-700 ring-slate-400',
  quiet: 'bg-white text-slate-500 ring-slate-200',
}

const ACTION_LABEL: Record<DecisionAction, string> = {
  flag_upgrade: 'URGENT upgrade',
  flag_downgrade: 'Likely downgrade',
  hold: 'Hold',
  recheck: 'Recheck',
  quiet: 'Quiet',
}

export function ActionChip({ action }: { action: DecisionAction }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset ${ACTION_STYLE[action]}`}>
      {ACTION_LABEL[action]}
    </span>
  )
}

const TIER_STYLE: Record<TrustTier, string> = {
  established: 'text-emerald-800 bg-emerald-50 ring-emerald-200',
  standard: 'text-slate-600 bg-slate-50 ring-slate-200',
  low: 'text-rose-700 bg-rose-50 ring-rose-200',
}

export function TierChip({ t }: { t: TrustUsed }) {
  const where = t.source === 'default' ? 'default' : t.source === 'all' ? 'all' : t.specialty
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1 py-px text-[10px] font-medium ring-1 ring-inset ${TIER_STYLE[t.tier]}`}>
      {t.tier} · {where}
    </span>
  )
}
