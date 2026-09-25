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
  /** Set by decide.ts after each cycle. */
  decision?: Decision
}

// ---------------------------------------------------------------------------
// GC preferences and decisions
// ---------------------------------------------------------------------------

export type Specialty = 'all' | 'cancer' | 'cardio' | 'neuro'
export type TrustTier = 'established' | 'standard' | 'low'

/** One row of the GC's lab trust list (data/gc_preferences.json). */
export interface LabTrust {
  lab: string
  specialty: Specialty
  tier: TrustTier
  set_at: string
  note: string
}

/** Every change to the trust list; entries are never overwritten silently. */
export interface TrustChange {
  lab: string
  specialty: Specialty
  old_tier: TrustTier | null
  new_tier: TrustTier
  at: string
  note: string
}

export interface GcPreferences {
  lab_trust: LabTrust[]
  trust_history: TrustChange[]
}

/** The tier used for one submitting lab in a decision; `source` says which trust entry (or the default) supplied it. */
export interface TrustUsed {
  lab: string
  specialty: Specialty
  tier: TrustTier
  source: 'specialty' | 'all' | 'default'
}

export type DecisionAction = 'quiet' | 'hold' | 'flag_downgrade' | 'flag_upgrade' | 'recheck'

export interface Decision {
  action: DecisionAction
  reason: string
  urgent: boolean
  trust_snapshot: TrustUsed[]
  decided_at: string
}

/** A GC's decision on one variant, saved from the patient drawer. */
export interface GcDecision {
  at: string
  variation_id: string
  decision: 'approve' | 'hold' | 'dismiss'
  reason: string
  /** Hold only: keep holding until an established lab calls it benign/likely benign. */
  until?: 'established_lab'
  /** "lab: classification" for each submission when the decision was made; later calls count as new. */
  calls_at_decision: string[]
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
  actions?: Partial<Record<DecisionAction, number>>
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
  gc_decisions: GcDecision[]
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
