import { useMemo, useState } from 'react'
import raw from '../data/caseload.json'
import rawPrefs from '../data/gc_preferences.json'
import type { Caseload, GcPreferences } from './types'
import { applyFilters, EMPTY_FILTERS, type Filters } from './lib/filters'
import { TopBar } from './components/TopBar'
import { SummaryStrip } from './components/SummaryStrip'
import { FilterPanel } from './components/FilterPanel'
import { Worklist } from './components/Worklist'
import { PatientDrawer } from './components/PatientDrawer'
import { LabTrustPanel } from './components/LabTrustPanel'

const caseload = raw as Caseload
const prefs = rawPrefs as GcPreferences

export default function App() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trustOpen, setTrustOpen] = useState(false)
  const patients = caseload.patients
  const visible = useMemo(() => applyFilters(patients, filters), [patients, filters])
  const selected = patients.find((p) => p.id === selectedId) ?? null

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-800">
      <TopBar
        clinic={caseload.clinic.name}
        department={caseload.clinic.department}
        gcName={caseload.gc.name}
        onLabTrust={() => setTrustOpen(true)}
      />
      <SummaryStrip
        patients={patients}
        lastCycle={caseload.last_cycle}
        onReset={() => setFilters(EMPTY_FILTERS)}
        onPick={({ vus, watch }) =>
          setFilters({ ...EMPTY_FILTERS, result: vus ? 'VUS' : 'All', watch: watch ? [watch] : [] })
        }
      />
      <div className="flex min-h-0 flex-1">
        <FilterPanel patients={patients} filters={filters} setFilters={setFilters} />
        <main className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1 text-[11px] text-slate-500">
            <span>
              Worklist · showing <span className="font-semibold text-slate-700">{visible.length}</span> of {patients.length}
            </span>
            <span>
              ClinVar data {caseload.variant_source === 'fallback' ? '(offline fallback)' : ''} as of{' '}
              {new Date(caseload.generated_at).toLocaleDateString('en-US')} · Fictional patients; real public ClinVar variants
            </span>
          </div>
          <Worklist patients={visible} selectedId={selectedId} onSelect={(p) => setSelectedId(p.id)} />
        </main>
        {selected && <PatientDrawer patient={selected} prefs={prefs} onClose={() => setSelectedId(null)} />}
      </div>
      {trustOpen && <LabTrustPanel prefs={prefs} patients={patients} onClose={() => setTrustOpen(false)} />}
    </div>
  )
}
