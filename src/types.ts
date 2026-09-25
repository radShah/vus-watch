export type ClinicArea = 'Cancer' | 'Cardio' | 'Neuro'
export type ResultCategory = 'Negative' | 'VUS' | 'Likely pathogenic' | 'Pathogenic'
export type WatchStatus = 'quiet' | 'active' | 'waiting_on_gc' | 'letter_drafted' | 'closed'

/** One lab's submitted classification (SCV), extracted from the ClinVar page by Liquid. */
export interface Submission {
  lab: string
  classification: 'Pathogenic' | 'Likely pathogenic' | 'Uncertain significance' | 'Likely benign' | 'Benign'
  last_evaluated: string | null
  first_in_clinvar: string | null
  scv_accession: string
  review_status: string | null
  condition: string | null
  evidence_tags: string[]
}

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
    /** Set by the agent cycle (live ClinVar page via Nimble). */
    record_version?: number
    record_last_updated?: string
    last_checked?: string
    source_url?: string
    /** Lab submissions extracted by Liquid; kept from the last successful extraction. */
    submissions?: Submission[]
    submissions_summary?: string
    extraction_status?: 'ok' | 'failed'
  }
  classification_changed: boolean
  watch_status: WatchStatus
}

/** One observed change on ClinVar, recorded by the agent cycle. */
export interface HistoryEntry {
  field: 'classification' | 'record_version' | 'submission'
  old: string | number | null
  new: string | number | null
  source_url: string
  observed_at: string
}

export interface CycleSummary {
  cycle: number
  started_at: string
  finished_at: string
  fetched: number
  unchanged: number
  changed: number
  failed: number
  liquid_ok?: number
  liquid_failed?: number
  liquid_cached?: number
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
  history: HistoryEntry[]
}

export interface Caseload {
  fictional: true
  disclaimer: string
  generated_at: string
  variant_source: 'eutils' | 'fallback'
  clinic: { name: string; department: string }
  gc: { name: string }
  patients: Patient[]
  last_cycle?: CycleSummary
}
