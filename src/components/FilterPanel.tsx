import type { ReactNode } from 'react'
import type { ClinicArea, Patient, WatchStatus } from '../types'
import { WATCH_LABEL, caseStatus, hasVus } from '../lib/clinical'
import { EMPTY_FILTERS, type Filters, type ResultFilter } from '../lib/filters'

interface Props {
  patients: Patient[]
  filters: Filters
  setFilters: (f: Filters) => void
}

const RESULTS: { value: ResultFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Negative', label: 'Negative' },
  { value: 'Likely pathogenic', label: 'Likely pathogenic' },
  { value: 'Pathogenic', label: 'Pathogenic' },
]
const AREAS: ClinicArea[] = ['Cancer', 'Cardio', 'Neuro']

const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 px-3 py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  )
}

function Check({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-px text-xs text-slate-700 hover:text-slate-900">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3 w-3 accent-blue-700" />
      <span className="flex-1">{label}</span>
      <span className="text-[11px] tabular-nums text-slate-400">{count}</span>
    </label>
  )
}

export function FilterPanel({ patients, filters: f, setFilters }: Props) {
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch })
  const genes = [...new Set(patients.flatMap((p) => p.variants.map((v) => v.gene)))].sort()
  const labs = [...new Set(patients.map((p) => p.testing_lab))].sort()
  const years = [...new Set(patients.map((p) => p.report_date.slice(0, 4)))].sort().reverse()
  const vusCount = patients.filter(hasVus).length
  const vusOn = f.result === 'VUS'

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 p-3">
        <input
          type="search"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search name, MRN, gene, variant…"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
        />
      </div>

      <Section title="Result">
        <button
          onClick={() => set({ result: vusOn ? 'All' : 'VUS' })}
          aria-pressed={vusOn}
          className={`mb-1.5 flex w-full items-center justify-between rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${
            vusOn ? 'bg-blue-700 text-white ring-blue-700' : 'bg-white text-blue-800 ring-blue-300 hover:bg-blue-50'
          }`}
        >
          <span>VUS only</span>
          <span className="tabular-nums opacity-80">{vusCount}</span>
        </button>
        <div className="flex flex-col">
          {RESULTS.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-2 py-px text-xs text-slate-700">
              <input
                type="radio"
                name="result"
                checked={f.result === r.value}
                onChange={() => set({ result: r.value })}
                className="h-3 w-3 accent-blue-700"
              />
              <span className="flex-1">{r.label}</span>
              <span className="text-[11px] tabular-nums text-slate-400">
                {r.value === 'All' ? patients.length : patients.filter((p) => p.result_category === r.value).length}
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Watch status">
        {(['quiet', 'active', 'waiting_on_gc', 'letter_drafted', 'closed'] as WatchStatus[]).map((s) => (
          <Check
            key={s}
            label={WATCH_LABEL[s]}
            checked={f.watch.includes(s)}
            onChange={() => set({ watch: toggle(f.watch, s) })}
            count={patients.filter((p) => caseStatus(p) === s).length}
          />
        ))}
      </Section>

      <Section title="Clinic area">
        {AREAS.map((a) => (
          <Check
            key={a}
            label={a}
            checked={f.areas.includes(a)}
            onChange={() => set({ areas: toggle(f.areas, a) })}
            count={patients.filter((p) => p.clinic_area === a).length}
          />
        ))}
      </Section>

      <Section title="Gene">
        <div className="flex flex-wrap gap-1">
          {genes.map((g) => {
            const on = f.genes.includes(g)
            return (
              <button
                key={g}
                onClick={() => set({ genes: toggle(f.genes, g) })}
                aria-pressed={on}
                className={`rounded px-1.5 py-px font-mono text-[11px] ring-1 ring-inset ${
                  on ? 'bg-blue-700 text-white ring-blue-700' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100'
                }`}
              >
                {g}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Testing lab">
        <select
          value={f.lab}
          onChange={(e) => set({ lab: e.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
        >
          <option value="">All labs</option>
          {labs.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </Section>

      <Section title="Report year">
        <select
          value={f.year}
          onChange={(e) => set({ year: e.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </Section>

      <div className="p-3">
        <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-blue-700 hover:underline">
          Clear all filters
        </button>
      </div>
    </aside>
  )
}
