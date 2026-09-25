import type { CycleSummary, Patient, WatchStatus } from '../types'
import { caseStatus, fmtDateTime, hasVus, isUrgent } from '../lib/clinical'

interface Props {
  patients: Patient[]
  lastCycle?: CycleSummary
  onPick: (pick: { vus?: boolean; watch?: WatchStatus }) => void
  onReset: () => void
}

export function SummaryStrip({ patients, lastCycle, onPick, onReset }: Props) {
  const count = (s: WatchStatus) => patients.filter((p) => caseStatus(p) === s).length
  const items: { label: string; value: number; onClick: () => void; emphasis?: boolean; alarm?: boolean }[] = [
    { label: 'Total patients', value: patients.length, onClick: onReset },
    { label: 'With VUS', value: patients.filter(hasVus).length, onClick: () => onPick({ vus: true }) },
    { label: 'Active cases', value: count('active'), onClick: () => onPick({ watch: 'active' }), emphasis: true },
    { label: 'Waiting on me', value: count('waiting_on_gc'), onClick: () => onPick({ watch: 'waiting_on_gc' }), emphasis: true },
    { label: 'Urgent upgrades', value: patients.filter(isUrgent).length, onClick: () => onPick({ watch: 'waiting_on_gc' }), alarm: true },
    { label: 'Letters to approve', value: count('letter_drafted'), onClick: () => onPick({ watch: 'letter_drafted' }) },
    { label: 'Closed', value: count('closed'), onClick: () => onPick({ watch: 'closed' }) },
  ]
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="flex divide-x divide-slate-200">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.onClick}
            className="flex flex-1 flex-col items-start px-4 py-1.5 text-left hover:bg-slate-50"
          >
            <span className="text-[11px] uppercase tracking-wide text-slate-500">{it.label}</span>
            <span className={`text-lg font-semibold leading-tight ${it.alarm && it.value ? 'text-red-700' : it.emphasis && it.value ? 'text-amber-700' : 'text-slate-800'}`}>
              {it.value}
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-0.5 text-[11px] text-slate-500">
        {lastCycle ? (
          <>
            Last cycle: <span className="font-medium text-slate-700">Cycle {lastCycle.cycle}</span> ·{' '}
            {fmtDateTime(lastCycle.finished_at)} · {lastCycle.fetched} fetched · {lastCycle.unchanged} unchanged ·{' '}
            <span className={lastCycle.changed ? 'font-semibold text-amber-700' : ''}>{lastCycle.changed} changed</span> ·{' '}
            <span className={lastCycle.failed ? 'font-semibold text-red-700' : ''}>{lastCycle.failed} failed</span>
            {lastCycle.actions && (
              <>
                {' '}· Decisions:{' '}
                {Object.entries(lastCycle.actions)
                  .map(([a, n]) => `${n} ${a.replace('_', ' ')}`)
                  .join(' · ')}
              </>
            )}
          </>
        ) : (
          'Last cycle: no cycle run yet'
        )}
      </div>
    </div>
  )
}
