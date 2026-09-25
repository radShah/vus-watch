import type { WatchStatus } from '../types'
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

export function Stars({ n, title }: { n: number; title?: string }) {
  return (
    <span title={title} className="whitespace-nowrap text-[11px] tracking-tight" aria-label={`${n} of 4 review stars`}>
      <span className="text-amber-500">{'★'.repeat(n)}</span>
      <span className="text-slate-300">{'★'.repeat(4 - n)}</span>
    </span>
  )
}
