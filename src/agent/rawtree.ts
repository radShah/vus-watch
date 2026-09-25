/**
 * Caseload history in RawTree (Tinybird). After each cycle, one row per case the
 * cycle checked (patient × variant) goes to the RawTree table; the dashboard's
 * "Caseload activity" strip reads per-cycle counts back with SQL.
 *
 * RawTree keeps every row (no TTL, no row deletes), so sync is idempotent: it sends
 * only cycles the table doesn't have yet, one insert per cycle with a dedup token.
 * Rows are rebuilt from data/events.jsonl, so a missed send is retried by the next
 * cycle or `npm run rawtree:sync`.
 *
 * Run: npm run rawtree:sync   (backfill + any missing cycles; no Nimble or Liquid calls)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAwaitingGc } from '../lib/clinical.ts'
import type { Caseload, CycleActivity, DecisionAction, WatchStatus } from '../types.ts'
import { EVENTS } from './events.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CASELOAD = join(ROOT, 'data', 'caseload.json')
const API = 'https://api.rawtree.com/v1'

/** One case (patient × variant) as checked by one cycle. */
export interface CaseCycleRow {
  cycle: number
  ts: string
  /** Set when the cycle ran with --variant; null for a full cycle */
  variant_filter: string | null
  patient_id: string
  gene: string | null
  variation_id: string
  /** The case's decision after this cycle (decisions are logged on change, so carried forward); null before decide.ts existed */
  decision: DecisionAction | null
  /** A decision event was written for this case in this cycle */
  decision_changed: boolean
  /** Only known for the cycle that produced the current caseload.json; null for backfilled cycles */
  watch_status: WatchStatus | null
  classification_before: string | null
  classification_after: string | null
  /** Labs whose submission changed on ClinVar this cycle, from the cycle's `changed` events */
  lab_changed: string | null
  parser_path: string | null
  /** decision != quiet */
  woke_up: boolean | null
  /** decision = flag_upgrade */
  urgent_upgrade: boolean | null
  /** watch_status is waiting_on_gc or letter_drafted */
  awaiting_gc: boolean | null
}

interface LogEvent {
  ts: string
  cycle?: number
  variation_id: string
  case_ids: string[]
  event_type: string
  field: string | null
  old: unknown
  new: unknown
  parser_path?: string | null
  action?: DecisionAction
}

export const table = () => process.env.RAWTREE_TABLE || 'vus_watch_case_cycles'

function apiKey(): string {
  if (!process.env.RAWTREE_API_KEY && existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
  const key = process.env.RAWTREE_API_KEY
  if (!key) throw new Error('RAWTREE_API_KEY is not set in .env')
  return key
}

async function call(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`RawTree ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** Run read-only SQL; returns the rows. */
export async function query<T>(sql: string): Promise<T[]> {
  return ((await call('/query', { sql, format: 'JSON' })) as { data: T[] }).data
}

/** Build the rows for every cycle in the event log, from events.jsonl plus the current caseload. */
export function buildRows(): Map<number, CaseCycleRow[]> {
  const caseload = JSON.parse(readFileSync(CASELOAD, 'utf8')) as Caseload
  const events = readFileSync(EVENTS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEvent)
    .filter((e) => typeof e.cycle === 'number')
  const variants = new Map<string, { gene: string; classification: string; watch_status: WatchStatus }>()
  for (const p of caseload.patients)
    for (const v of p.variants)
      variants.set(`${p.id}|${v.clinvar.variation_id}`, { gene: v.gene, classification: v.clinvar.classification, watch_status: v.watch_status })

  const cycles = [...new Set(events.map((e) => e.cycle!))].sort((a, b) => a - b)
  const latest = caseload.last_cycle?.cycle
  const out = new Map<number, CaseCycleRow[]>()
  const decisionSoFar = new Map<string, DecisionAction>()

  for (const cycle of cycles) {
    const evs = events.filter((e) => e.cycle === cycle)
    const decidedNow = new Set<string>()
    for (const e of evs)
      if (e.event_type === 'decision' && e.action) {
        const key = `${e.case_ids[0]}|${e.variation_id}`
        decisionSoFar.set(key, e.action)
        decidedNow.add(key)
      }
    const fetches = evs.filter((e) => e.event_type === 'fetch_ok' || e.event_type === 'fetch_failed')
    // A --variant cycle fetches exactly one Variation ID; the caseload records which for the latest cycle
    const variant_filter =
      cycle === latest ? (caseload.last_cycle?.variant_filter ?? null) : fetches.length === 1 ? fetches[0].variation_id : null
    const ts = cycle === latest && caseload.last_cycle ? caseload.last_cycle.finished_at : evs[evs.length - 1].ts

    const rows: CaseCycleRow[] = []
    for (const f of fetches)
      for (const patient_id of f.case_ids) {
        const key = `${patient_id}|${f.variation_id}`
        const now = variants.get(key)
        const changes = evs.filter((e) => e.event_type === 'changed' && e.variation_id === f.variation_id)
        const clsChange = changes.find((e) => e.field === 'classification')
        // Classification after this cycle: current value, unwound through later classification changes
        const later = events.find((e) => e.cycle! > cycle && e.event_type === 'changed' && e.field === 'classification' && e.variation_id === f.variation_id)
        const after = clsChange ? String(clsChange.new) : later ? String(later.old) : (now?.classification ?? null)
        const labs = [
          ...new Set(
            changes.filter((e) => e.field === 'submission').map((e) => String(e.new ?? e.old).split(': ')[0]),
          ),
        ]
        const decision = decisionSoFar.get(key) ?? null
        const watch_status = cycle === latest ? (now?.watch_status ?? null) : null
        rows.push({
          cycle,
          ts,
          variant_filter,
          patient_id,
          gene: now?.gene ?? null,
          variation_id: f.variation_id,
          decision,
          decision_changed: decidedNow.has(key),
          watch_status,
          classification_before: clsChange ? String(clsChange.old) : after,
          classification_after: after,
          lab_changed: labs.length ? labs.join(', ') : null,
          parser_path: f.parser_path ?? null,
          woke_up: decision ? decision !== 'quiet' : null,
          urgent_upgrade: decision ? decision === 'flag_upgrade' : null,
          awaiting_gc: watch_status ? isAwaitingGc(watch_status) : null,
        })
      }
    out.set(cycle, rows)
  }
  return out
}

async function sentCycles(): Promise<Set<number>> {
  try {
    return new Set((await query<{ cycle: number }>(`SELECT DISTINCT cycle FROM ${table()}`)).map((r) => Number(r.cycle)))
  } catch (e) {
    // First run: the table is created by the first insert
    if (/UNKNOWN_TABLE|doesn't exist|does not exist|not found/i.test(String(e))) return new Set()
    throw e
  }
}

/** Send every cycle RawTree doesn't have yet. Returns the cycles sent. */
export async function syncRawtree(log: (msg: string) => void = console.log): Promise<number[]> {
  const rows = buildRows()
  const have = await sentCycles()
  const sent: number[] = []
  for (const [cycle, batch] of rows) {
    if (have.has(cycle) || !batch.length) continue
    const qs = new URLSearchParams({ deduplicate_insert: 'enable', insert_deduplication_token: `${table()}-${cycle}` })
    await call(`/tables/${table()}?${qs}`, batch)
    sent.push(cycle)
    log(`RawTree: cycle ${cycle}${batch[0].variant_filter ? ` (--variant ${batch[0].variant_filter})` : ''} → ${batch.length} rows`)
  }
  if (!sent.length) log(`RawTree: up to date (${have.size} cycles in ${table()})`)
  return sent
}

/** For the cycle script: never fail the cycle because RawTree is down; the next run retries. */
export async function syncRawtreeSafely(): Promise<void> {
  try {
    await syncRawtree()
  } catch (e) {
    console.warn(`RawTree sync FAILED (the cycle is saved; run \`npm run rawtree:sync\` to retry): ${e instanceof Error ? e.message : e}`)
  }
}

/**
 * Per-cycle counts for the dashboard. Flags are computed in TypeScript (buildRows) and
 * the SQL only counts distinct patients with each flag, the way the worklist counts cases.
 * A count is null when any row in the cycle lacks that flag (backfilled cycles).
 */
export async function caseloadActivity(): Promise<CycleActivity[]> {
  const rows = await query<Record<string, unknown>>(`
    SELECT
      cycle,
      max(ts) AS ts,
      any(variant_filter) AS variant_filter,
      uniqExact(patient_id) AS cases_watched,
      if(countIf(woke_up IS NULL) > 0, NULL, uniqExactIf(patient_id, woke_up = true)) AS cases_woke_up,
      if(countIf(urgent_upgrade IS NULL) > 0, NULL, uniqExactIf(patient_id, urgent_upgrade = true)) AS urgent_upgrades,
      if(countIf(awaiting_gc IS NULL) > 0, NULL, uniqExactIf(patient_id, awaiting_gc = true)) AS awaiting_gc
    FROM ${table()}
    GROUP BY cycle
    ORDER BY cycle`)
  const num = (v: unknown) => (v == null ? null : Number(v))
  return rows.map((r) => ({
    cycle: Number(r.cycle),
    // RawTree returns DateTime64 as "YYYY-MM-DD hh:mm:ss.fffffffff" in UTC
    ts: new Date(`${String(r.ts).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/Z?$/, 'Z')}`).toISOString(),
    variant_filter: r.variant_filter ? String(r.variant_filter) : null,
    cases_watched: Number(r.cases_watched),
    cases_woke_up: num(r.cases_woke_up),
    urgent_upgrades: num(r.urgent_upgrades),
    awaiting_gc: num(r.awaiting_gc),
  }))
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  syncRawtree().catch((e) => {
    console.error(e)
    process.exit(1)
  })
