/**
 * One agent cycle: fetch each watched ClinVar variant live via Nimble, compare
 * against the caseload, record changes, and append events.
 *
 * Run: npm run cycle
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchClinvarVariant, UNKNOWN, type ClinvarRecord } from '../src/agent/nimbleClinvar.ts'
import type { Caseload, HistoryEntry, Patient, Variant } from '../src/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CASELOAD = join(ROOT, 'data', 'caseload.json')
const EVENTS = join(ROOT, 'data', 'events.jsonl')
const REQUIRED_ID = '3672027'
const DELAY_MS = 1000
const CHANGED_ACTION = 'Review: classification changed on ClinVar'

process.loadEnvFile(join(ROOT, '.env'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const inScope = (v: Variant) =>
  v.reported_classification.classification === 'Uncertain significance' ||
  v.clinvar.classification.toLowerCase().includes('conflicting') ||
  v.watch_status === 'active' ||
  v.clinvar.variation_id === REQUIRED_ID

type EventType = 'fetch_ok' | 'fetch_failed' | 'compare_unchanged' | 'baseline' | 'changed' | 'field_unknown'

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
  const counts = { fetched: 0, unchanged: 0, changed: 0, failed: 0 }
  const records = new Map<string, ClinvarRecord>()
  const ids = [...targets.keys()]
  console.log(`Cycle ${cycle}: ${ids.length} variants across ${new Set([...targets.values()].flat().map((t) => t.patient.id)).size} cases`)

  for (const [i, id] of ids.entries()) {
    if (i) await sleep(DELAY_MS)
    const pairs = targets.get(id)!
    const case_ids = [...new Set(pairs.map((p) => p.patient.id))]
    const rec = await fetchWithRetry(id)
    records.set(id, rec)
    const ev = (event_type: EventType, field: string | null = null, old: unknown = null, nw: unknown = null) =>
      events.push({
        ts: new Date().toISOString(),
        cycle,
        variation_id: id,
        case_ids,
        event_type,
        field,
        old,
        new: nw,
        source_url: rec.source_url,
        parser_path: rec.parser_path ?? null,
      })

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
        } else c.record_version = d.new as number
      }
      variant.watch_status = 'active'
      patient.next_action = CHANGED_ACTION
    }

    if (variantChanged) counts.changed++
    else {
      counts.unchanged++
      ev('compare_unchanged')
    }
    console.log(`  ${id}  ${variantChanged ? 'CHANGED' : 'unchanged'}  v${rec.record_version}  ${rec.overall_classification}  [${rec.parser_path}]`)
  }

  caseload.last_cycle = { cycle, started_at, finished_at: new Date().toISOString(), ...counts }

  appendFileSync(EVENTS, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const tmp = `${CASELOAD}.tmp`
  writeFileSync(tmp, JSON.stringify(caseload, null, 2) + '\n')
  renameSync(tmp, CASELOAD)

  const paths = events.filter((e) => e.event_type === 'fetch_ok').map((e) => e.parser_path)
  console.log(
    `\nCycle ${cycle} summary: ${ids.length} variants · ${counts.fetched} fetched · ${counts.unchanged} unchanged · ${counts.changed} changed · ${counts.failed} failed`,
  )
  console.log(`Parser path: ${paths.filter((p) => p === 'nimble_parser').length} nimble_parser, ${paths.filter((p) => p === 'local_parser').length} local_parser`)
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
