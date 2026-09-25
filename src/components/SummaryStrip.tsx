import type { Patient, WatchStatus } from '../types'
import { caseStatus, hasVus } from '../lib/clinical'

interface Props {
  patients: Patient[]
  onPick: (pick: { vus?: boolean; watch?: WatchStatus }) => void
  onReset: () => void
}

export function SummaryStrip({ patients, onPick, onReset }: Props) {
  const count = (s: WatchStatus) => patients.filter((p) => caseStatus(p) === s).length
  const items: { label: string; value: number; onClick: () => void; emphasis?: boolean }[] = [
    { label: 'Total patients', value: patients.length, onClick: onReset },
    { label: 'With VUS', value: patients.filter(hasVus).length, onClick: () => onPick({ vus: true }) },
    { label: 'Active cases', value: count('active'), onClick: () => onPick({ watch: 'active' }), emphasis: true },
    { label: 'Waiting on me', value: count('waiting_on_gc'), onClick: () => onPick({ watch: 'waiting_on_gc' }) },
    { label: 'Letters to approve', value: count('letter_drafted'), onClick: () => onPick({ watch: 'letter_drafted' }) },
    { label: 'Closed', value: count('closed'), onClick: () => onPick({ watch: 'closed' }) },
  ]
  return (
    <div className="flex divide-x divide-slate-200 border-b border-slate-200 bg-white">
      {items.map((it) => (
        <button
          key={it.label}
          onClick={it.onClick}
          className="flex flex-1 flex-col items-start px-4 py-1.5 text-left hover:bg-slate-50"
        >
          <span className="text-[11px] uppercase tracking-wide text-slate-500">{it.label}</span>
          <span className={`text-lg font-semibold leading-tight ${it.emphasis && it.value ? 'text-amber-700' : 'text-slate-800'}`}>
            {it.value}
          </span>
        </button>
      ))}
    </div>
  )
}
