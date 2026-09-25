export type ClinicArea = 'Cancer' | 'Cardio' | 'Neuro'
export type ResultCategory = 'Negative' | 'VUS' | 'Likely pathogenic' | 'Pathogenic'
export type WatchStatus = 'quiet' | 'active' | 'waiting_on_gc' | 'letter_drafted' | 'closed'

export interface Variant {
  gene: string
  hgvs: string
  zygosity: string
  reported_classification: { classification: string; lab: string; date: string }
  clinvar: {
    variation_id: string
    vcv: string
    url: string
    classification: string
    review_status: string
    last_evaluated: string | null
  }
  classification_changed: boolean
  watch_status: WatchStatus
}

export interface Patient {
  id: string
  mrn: string
  name: string
  dob: string
  age: number
  sex: 'F' | 'M'
  clinic_area: ClinicArea
  indication: string
  ordering_provider: string
  testing_lab: string
  test_name: string
  report_date: string
  result_category: ResultCategory
  variants: Variant[]
  last_checked: string
  next_action: string
  gc_decisions: unknown[]
  history: unknown[]
}

export interface Caseload {
  fictional: true
  disclaimer: string
  generated_at: string
  variant_source: 'eutils' | 'fallback'
  clinic: { name: string; department: string }
  gc: { name: string }
  patients: Patient[]
}
