import type { ClinicArea, Patient, WatchStatus } from '../types'
import { caseStatus, hasVus } from './clinical'

export type ResultFilter = 'All' | 'Negative' | 'VUS' | 'Likely pathogenic' | 'Pathogenic'

export interface Filters {
  result: ResultFilter
  watch: WatchStatus[]
  areas: ClinicArea[]
  genes: string[]
  lab: string
  year: string
  q: string
}

export const EMPTY_FILTERS: Filters = { result: 'All', watch: [], areas: [], genes: [], lab: '', year: '', q: '' }

export function applyFilters(patients: Patient[], f: Filters): Patient[] {
  const q = f.q.trim().toLowerCase()
  return patients.filter((p) => {
    if (f.result === 'VUS' ? !hasVus(p) : f.result !== 'All' && p.result_category !== f.result) return false
    if (f.watch.length) {
      const s = caseStatus(p)
      if (!s || !f.watch.includes(s)) return false
    }
    if (f.areas.length && !f.areas.includes(p.clinic_area)) return false
    if (f.genes.length && !p.variants.some((v) => f.genes.includes(v.gene))) return false
    if (f.lab && p.testing_lab !== f.lab) return false
    if (f.year && !p.report_date.startsWith(f.year)) return false
    if (q) {
      const hay = [
        p.name,
        p.mrn,
        ...p.variants.flatMap((v) => [v.gene, v.hgvs, v.clinvar.vcv, v.clinvar.variation_id]),
      ]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
