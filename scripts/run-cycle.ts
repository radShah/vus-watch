/**
 * One agent cycle: fetch each watched ClinVar variant live via Nimble, extract
 * its lab submissions with Liquid, compare against the caseload, record
 * changes, decide what to do with each watched case (decide.ts), and append
 * events.
 *
 * Run: npm run cycle
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDecision, decide, nextAction } from '../src/agent/decide.ts'
import { appendEvents } from '../src/agent/events.ts'
import { loadPrefs } from '../src/agent/gcPreferences.ts'
import { extractSubmissions, summarizeSubmissions, type ExtractionResult, type LiquidCall } from '../src/agent/liquidExtract.ts'
import { fetchClinvarVariant, UNKNOWN, type ClinvarRecord } from '../src/agent/nimbleClinvar.ts'
import type { Caseload, DecisionAction, HistoryEntry, Patient, Submission, Variant } from '../src/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CASELOAD = join(ROOT, 'data', 'caseload.json')
const REQUIRED_ID = '3672027'
const DELAY_MS = 1000
const CHANGED_ACTION = 'Review: classification changed on ClinVar'
const SUBMISSION_ACTION = 'Review: lab submission changed on ClinVar'

process.loadEnvFile(join(ROOT, '.env'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const inScope = (v: Variant) =>
  v.reported_classification.classification === 'Uncertain significance' ||
  v.clinvar.classification.toLowerCase().includes('conflicting') ||
  v.watch_status === 'active' ||
  v.clinvar.variation_id === REQUIRED_ID

type EventType = 'fetch_ok' | 'fetch_failed' | 'compare_unchanged' | 'baseline' | 'changed' | 'field_unknown' | 'liquid_extract' | 'decision'

interface CycleEvent {
  ts: string
  cycle: number
  variation_id: string
  case_ids: string[]
  event_type: EventType
  field: string | null
  old: unknown
  new: unknown
  source_url: string
  parser_path: ClinvarRecord['parser_path'] | null
  /** liquid_extract only */
  status?: LiquidCall['status']
  attempt?: number
  model?: string
  duration_ms?: number
  error?: string
  /** decision only */
  action?: DecisionAction
  reason?: string
}

/** Submissions keyed by SCV accession without its version (a new version of the same SCV is the same lab's record). */
const scvKey = (s: Submission) => s.scv_accession.split('.')[0] || s.lab
const call = (s: Submission) => `${s.lab}: ${s.classification}`

/** New labs, labs that changed their call, and labs that dropped out. */
function submissionDiffs(old: Submission[], nw: Submission[]): { old: string | null; new: string | null }[] {
  const before = new Map(old.map((s) => [scvKey(s), s]))
  const after = new Map(nw.map((s) => [scvKey(s), s]))
  const out: { old: string | null; new: string | null }[] = []
  for (const [k, s] of after) {
    const prev = before.get(k)
    if (!prev) out.push({ old: null, new: call(s) })
    else if (prev.classification !== s.classification) out.push({ old: call(prev), new: call(s) })
  }
  for (const [k, s] of before) if (!after.has(k)) out.push({ old: call(s), new: null })
  return out
}

async function fetchWithRetry(id: string): Promise<ClinvarRecord> {
  const first = await fetchClinvarVariant(id)
  if (first.ok) return first
  console.warn(`  retry ${id}: ${first.error}`)
  await sleep(DELAY_MS)
  return fetchClinvarVariant(id)
}

async function main() {
  const caseload = JSON.parse(readFileSync(CASELOAD, 'utf8')) as Caseload
  const prefs = loadPrefs()
  const cycle = (caseload.last_cycle?.cycle ?? 0) + 1
  const started_at = new Date().toISOString()

  // variation_id → the (patient, variant) pairs that carry it
  const targets = new Map<string, { patient: Patient; variant: Variant }[]>()
  for (const patient of caseload.patients)
    for (const variant of patient.variants)
      if (inScope(variant)) {
        const id = variant.clinvar.variation_id
        targets.set(id, [...(targets.get(id) ?? []), { patient, variant }])
      }
  if (!targets.has(REQUIRED_ID)) console.warn(`No case carries ${REQUIRED_ID}; fetching it anyway.`)
  targets.set(REQUIRED_ID, targets.get(REQUIRED_ID) ?? [])

  const events: CycleEvent[] = []
  const counts = { fetched: 0, unchanged: 0, changed: 0, failed: 0, liquid_ok: 0, liquid_failed: 0, liquid_cached: 0 }
  const records = new Map<string, ClinvarRecord>()
  const ids = [...targets.keys()]
  console.log(`Cycle ${cycle}: ${ids.length} variants across ${new Set([...targets.values()].flat().map((t) => t.patient.id)).size} cases`)

  for (const [i, id] of ids.entries()) {
    if (i) await sleep(DELAY_MS)
    const pairs = targets.get(id)!
    const case_ids = [...new Set(pairs.map((p) => p.patient.id))]
    const rec = await fetchWithRetry(id)
    records.set(id, rec)
    const base = (event_type: EventType): CycleEvent => ({
      ts: new Date().toISOString(),
      cycle,
      variation_id: id,
      case_ids,
      event_type,
      field: null,
      old: null,
      new: null,
      source_url: rec.source_url,
      parser_path: rec.parser_path ?? null,
    })
    const ev = (event_type: EventType, field: string | null = null, old: unknown = null, nw: unknown = null) =>
      events.push({ ...base(event_type), field, old, new: nw })

    if (!rec.ok) {
      counts.failed++
      ev('fetch_failed', null, null, rec.error ?? null)
      console.log(`  ${id}  FAILED  ${rec.error}`)
      continue
    }
    counts.fetched++
    ev('fetch_ok')

    for (const field of ['overall_classification', 'review_status', 'record_last_updated', 'submissions_table'] as const)
      if (rec[field] === UNKNOWN) ev('field_unknown', field)
    if (rec.record_version === UNKNOWN) ev('field_unknown', 'record_version')

    // Lab submissions via Liquid, once per variant (cached by variation_id + record_version)
    const extraction: ExtractionResult =
      rec.submissions_text === UNKNOWN
        ? { status: 'failed', from_cache: false, submissions: [], error: 'no submission rows parsed' }
        : await extractSubmissions(rec.submissions_text, {
            variationId: id,
            recordVersion: rec.record_version === UNKNOWN ? null : rec.record_version,
            onCall: (c) => events.push({ ...base('liquid_extract'), ...c }),
          })
    if (extraction.status === 'failed') counts.liquid_failed++
    else if (extraction.from_cache) counts.liquid_cached++
    else counts.liquid_ok++

    let variantChanged = false
    for (const { patient, variant } of pairs) {
      const c = variant.clinvar
      const now = rec.fetched_at
      const diffs: HistoryEntry[] = []

      if (rec.overall_classification !== UNKNOWN && rec.overall_classification !== c.classification)
        diffs.push({ field: 'classification', old: c.classification, new: rec.overall_classification, source_url: rec.source_url, observed_at: now })

      if (rec.record_version !== UNKNOWN) {
        if (c.record_version == null) ev('baseline', 'record_version', null, rec.record_version)
        else if (rec.record_version !== c.record_version)
          diffs.push({ field: 'record_version', old: c.record_version, new: rec.record_version, source_url: rec.source_url, observed_at: now })
      }

      if (extraction.status === 'ok') {
        if (!c.submissions) ev('baseline', 'submissions', null, extraction.submissions.length)
        else
          for (const d of submissionDiffs(c.submissions, extraction.submissions))
            diffs.push({ field: 'submission', ...d, source_url: rec.source_url, observed_at: now })
        c.submissions = extraction.submissions
        c.submissions_summary = summarizeSubmissions(extraction.submissions)
      }
      // A failed extraction keeps the last good submissions
      c.extraction_status = extraction.status

      // Fields that are refreshed but not compared
      if (rec.review_status !== UNKNOWN) c.review_status = rec.review_status
      if (rec.record_last_updated !== UNKNOWN) c.record_last_updated = rec.record_last_updated
      if (rec.record_version !== UNKNOWN && c.record_version == null) c.record_version = rec.record_version
      c.source_url = rec.source_url
      c.last_checked = now
      patient.last_checked = now

      if (!diffs.length) continue
      variantChanged = true
      for (const d of diffs) {
        patient.history.push(d)
        ev('changed', d.field, d.old, d.new)
        if (d.field === 'classification') {
          c.classification = d.new as string
          variant.classification_changed = true
        } else if (d.field === 'record_version') c.record_version = d.new as number
      }
      variant.watch_status = 'active'
      patient.next_action = diffs.some((d) => d.field === 'classification') ? CHANGED_ACTION : SUBMISSION_ACTION
    }

    if (variantChanged) counts.changed++
    else {
      counts.unchanged++
      ev('compare_unchanged')
    }
    const liquid = extraction.status === 'failed' ? `liquid FAILED (${extraction.error})` : extraction.from_cache ? 'liquid cache' : 'liquid ok'
    console.log(`  ${id}  ${variantChanged ? 'CHANGED' : 'unchanged'}  v${rec.record_version}  ${rec.overall_classification}  [${rec.parser_path}] [${liquid}]`)
  }

  // Decide what to do with each watched case (deterministic GC rules; see decide.ts)
  const actions: Partial<Record<DecisionAction, number>> = {}
  const decidedPatients = new Set<Patient>()
  for (const [id, pairs] of targets)
    for (const { patient, variant } of pairs) {
      const rec = records.get(id)
      const prev = variant.decision
      const d = decide(patient, variant, prefs, { now: new Date().toISOString(), readOk: !!rec?.ok })
      applyDecision(patient, variant, d)
      decidedPatients.add(patient)
      actions[d.action] = (actions[d.action] ?? 0) + 1
      if (prev?.action !== d.action || prev?.reason !== d.reason)
        events.push({
          ts: d.decided_at,
          cycle,
          variation_id: id,
          case_ids: [patient.id],
          event_type: 'decision',
          field: null,
          old: prev?.action ?? null,
          new: d.action,
          source_url: rec?.source_url ?? variant.clinvar.url,
          parser_path: rec?.parser_path ?? null,
          action: d.action,
          reason: d.reason,
        })
    }
  for (const patient of decidedPatients) patient.next_action = nextAction(patient) ?? patient.next_action

  caseload.last_cycle = { cycle, started_at, finished_at: new Date().toISOString(), ...counts, actions }

  appendEvents(events)
  const tmp = `${CASELOAD}.tmp`
  writeFileSync(tmp, JSON.stringify(caseload, null, 2) + '\n')
  renameSync(tmp, CASELOAD)

  const paths = events.filter((e) => e.event_type === 'fetch_ok').map((e) => e.parser_path)
  console.log(
    `\nCycle ${cycle} summary: ${ids.length} variants · ${counts.fetched} fetched · ${counts.unchanged} unchanged · ${counts.changed} changed · ${counts.failed} failed`,
  )
  console.log(`Liquid extraction: ${counts.liquid_ok} extracted OK · ${counts.liquid_failed} failed · ${counts.liquid_cached} from cache`)
  console.log(`Parser path: ${paths.filter((p) => p === 'nimble_parser').length} nimble_parser, ${paths.filter((p) => p === 'local_parser').length} local_parser`)
  console.log(`Decisions: ${Object.entries(actions).map(([a, n]) => `${n} ${a}`).join(' · ')}`)
  const req = records.get(REQUIRED_ID)
  if (req) {
    const { raw_path: _raw, ...shown } = req
    console.log(`\n${REQUIRED_ID} normalized:\n${JSON.stringify(shown, null, 2)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
