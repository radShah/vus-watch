/**
 * Structured lab submissions from a ClinVar submissions table, extracted by a
 * Liquid model on OpenRouter. The model's output is validated in code against
 * the input text (allowed values, real dates, every accession/lab/date present
 * in the source). An invalid answer is retried once; after that the extraction
 * is "failed" and no fields are filled. Never guessed.
 *
 * Successful extractions are cached by variation_id + record_version in
 * .cache/liquid/, so an unchanged ClinVar record is never re-sent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'liquid')
const RETRY_DELAY_MS = 3000
/** Backoff for rate limits / provider errors (free tier). These don't count as the one retry for an invalid answer. */
const TRANSIENT_BACKOFF_MS = [5000, 15000, 30000]

export const SUBMISSION_CLASSIFICATIONS = ['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign'] as const

export const EVIDENCE_TAGS = [
  'population_data_absent',
  'population_data_present',
  'insufficient_evidence',
  'conflicting_evidence',
  'functional_evidence',
  'segregation_evidence',
  'computational_evidence',
  'de_novo',
  'case_observations',
] as const

export interface Submission {
  lab: string
  classification: (typeof SUBMISSION_CLASSIFICATIONS)[number]
  last_evaluated: string | null
  first_in_clinvar: string | null
  scv_accession: string
  review_status: string | null
  condition: string | null
  evidence_tags: (typeof EVIDENCE_TAGS)[number][]
}

export interface ExtractionResult {
  status: 'ok' | 'failed'
  from_cache: boolean
  submissions: Submission[]
  error?: string
}

/** One Liquid call, for data/events.jsonl. */
export interface LiquidCall {
  status: 'ok' | 'invalid' | 'http_error'
  attempt: number
  model: string
  duration_ms: number
  error?: string
}

const SYSTEM = `You extract ClinVar lab submissions into JSON. Use ONLY information in the text. Never invent values.

Each input line is one submission row. Return ONLY a JSON array with exactly one object per row, in row order, no prose, no code fences:
[{"lab": string, "classification": string, "last_evaluated": "YYYY-MM-DD" | null, "first_in_clinvar": "YYYY-MM-DD" | null, "scv_accession": string, "review_status": string | null, "condition": string | null, "evidence_tags": string[]}]

Rules:
- lab: the submitter name exactly as written before "Accession:".
- classification: exactly one of ${SUBMISSION_CLASSIFICATIONS.map((c) => `"${c}"`).join(', ')}.
- last_evaluated: the date in parentheses after the classification. first_in_clinvar: the date after "First in ClinVar:". Convert "Feb 27, 2025" to "2025-02-27". null if missing.
- scv_accession: the "SCV..." value with its version, e.g. "SCV000123456.2".
- review_status: the review status text without the assertion criteria in parentheses, e.g. "criteria provided, single submitter".
- condition: the condition text. null if missing.
- evidence_tags: only from the row's "Comment:" text, chosen from ${EVIDENCE_TAGS.map((t) => `"${t}"`).join(', ')}. Add every tag the comment supports:
  population_data_absent = variant not reported / absent in gnomAD or population cohorts
  population_data_present = variant observed in gnomAD or population cohorts at some frequency
  insufficient_evidence = insufficient evidence, or the significance remains unclear
  conflicting_evidence = evidence described as conflicting
  functional_evidence = functional / in vitro / RNA / protein studies
  segregation_evidence = segregation or co-segregation with disease in a family
  computational_evidence = in silico / computational / prediction tools
  de_novo = variant arose de novo
  case_observations = observed in affected individuals or published cases
  Use [] if the row has no "Comment:".`

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** "2026-06-02" → ClinVar's display forms ["Jun 2, 2026", "Jun 02, 2026"], or null if not a real date. */
function displayDates(iso: string): string[] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null
  const mon = MONTHS[Number(m[2]) - 1]
  return [`${mon} ${Number(m[3])}, ${m[1]}`, `${mon} ${m[3]}, ${m[1]}`]
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

/** Parse and check the model's answer against the source text. Returns the submissions or the list of problems. */
export function validate(content: string, text: string): { ok: true; submissions: Submission[] } | { ok: false; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(content))
  } catch {
    return { ok: false, errors: ['not valid JSON'] }
  }
  if (parsed && !Array.isArray(parsed) && Array.isArray((parsed as { submissions?: unknown }).submissions))
    parsed = (parsed as { submissions: unknown[] }).submissions
  if (!Array.isArray(parsed)) return { ok: false, errors: ['not a JSON array'] }

  const rows = text.split('\n').filter((l) => l.trim())
  const errors: string[] = []
  if (parsed.length !== rows.length) errors.push(`expected ${rows.length} submissions, got ${parsed.length}`)

  const hay = norm(text)
  const inText = (s: string) => hay.includes(norm(s))
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const out: Submission[] = []

  parsed.forEach((raw, i) => {
    const e = (msg: string) => errors.push(`#${i + 1}: ${msg}`)
    if (!raw || typeof raw !== 'object') return e('not an object')
    const o = raw as Record<string, unknown>

    const scv = str(o.scv_accession)
    if (!scv || !/^SCV\d+\.\d+$/.test(scv)) e(`scv_accession ${JSON.stringify(o.scv_accession)} is not SCV<digits>.<version>`)
    else if (!text.includes(scv)) e(`scv_accession ${scv} not in text`)
    const row = scv ? rows.find((r) => r.includes(scv)) : undefined

    const lab = str(o.lab)
    if (!lab) e('lab missing')
    else if (!(row ?? text).includes(lab)) e(`lab "${lab}" not in its row`)

    const cls = o.classification
    if (!SUBMISSION_CLASSIFICATIONS.includes(cls as Submission['classification'])) e(`classification ${JSON.stringify(cls)} not allowed`)

    const dates: Record<'last_evaluated' | 'first_in_clinvar', string | null> = { last_evaluated: null, first_in_clinvar: null }
    for (const k of ['last_evaluated', 'first_in_clinvar'] as const) {
      const v = o[k]
      if (v == null) continue
      const shown = typeof v === 'string' ? displayDates(v) : null
      if (!shown) e(`${k} ${JSON.stringify(v)} is not a YYYY-MM-DD date`)
      else if (!shown.some((d) => (row ?? text).includes(d))) e(`${k} ${v} (${shown[0]}) not in its row`)
      else dates[k] = v as string
    }

    const review = str(o.review_status)
    if (review && !inText(review)) e(`review_status "${review}" not in text`)
    const condition = str(o.condition)
    if (condition && !inText(condition)) e(`condition "${condition}" not in text`)

    const tags = o.evidence_tags
    if (!Array.isArray(tags)) e('evidence_tags is not an array')
    else {
      const bad = tags.filter((t) => !EVIDENCE_TAGS.includes(t))
      if (bad.length) e(`evidence_tags not allowed: ${bad.join(', ')}`)
      if (tags.length && row && !row.includes('Comment:')) e('evidence_tags given but the row has no comment')
    }

    out.push({
      lab: lab ?? '',
      classification: cls as Submission['classification'],
      ...dates,
      scv_accession: scv ?? '',
      review_status: review,
      condition,
      evidence_tags: Array.isArray(tags) ? [...new Set(tags as Submission['evidence_tags'])] : [],
    })
  })

  const scvs = out.map((s) => s.scv_accession)
  if (new Set(scvs).size !== scvs.length) errors.push('duplicate scv_accession')
  return errors.length ? { ok: false, errors } : { ok: true, submissions: out }
}

// ---------------------------------------------------------------------------
// Liquid call
// ---------------------------------------------------------------------------

function config(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.LIQUID_MODEL
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (.env)')
  if (!model) throw new Error('LIQUID_MODEL is not set (.env)')
  return { apiKey, model }
}

/** POST to OpenRouter; returns choices[0].message.content only (any "reasoning" field is ignored). */
async function complete(messages: { role: string; content: string }[]): Promise<string> {
  const { apiKey, model } = config()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  })
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } } | null
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${body?.error?.message ?? res.statusText}`), {
      // A daily quota won't clear with backoff; per-minute limits and provider errors might.
      transient: (res.status === 429 && !/per-day/i.test(body?.error?.message ?? '')) || res.status >= 500,
    })
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('no choices[0].message.content')
  return content
}

const cachePath = (variationId: string, recordVersion: number) => join(CACHE_DIR, `${variationId}-v${recordVersion}.json`)

export async function extractSubmissions(
  submissionsTableText: string,
  opts: { variationId: string; recordVersion: number | null; onCall?: (call: LiquidCall) => void },
): Promise<ExtractionResult> {
  const { variationId, recordVersion, onCall } = opts
  const path = recordVersion == null ? null : cachePath(variationId, recordVersion)
  if (path && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { submissions: Submission[] }
    return { status: 'ok', from_cache: true, submissions: cached.submissions }
  }

  const model = config().model
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: submissionsTableText },
  ]
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let lastError = ''
  let transientRetries = 0
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS)
    const t0 = Date.now()
    let content: string
    try {
      content = await complete(messages)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      onCall?.({ status: 'http_error', attempt, model, duration_ms: Date.now() - t0, error: lastError })
      if ((e as { transient?: boolean }).transient && transientRetries < TRANSIENT_BACKOFF_MS.length) {
        await sleep(TRANSIENT_BACKOFF_MS[transientRetries++])
        attempt--
      }
      continue
    }
    const v = validate(content, submissionsTableText)
    const duration_ms = Date.now() - t0
    if (v.ok) {
      onCall?.({ status: 'ok', attempt, model, duration_ms })
      if (path) {
        mkdirSync(CACHE_DIR, { recursive: true })
        writeFileSync(path, JSON.stringify({ variation_id: variationId, record_version: recordVersion, model, extracted_at: new Date().toISOString(), submissions: v.submissions }, null, 2) + '\n')
      }
      return { status: 'ok', from_cache: false, submissions: v.submissions }
    }
    lastError = v.errors.join('; ')
    onCall?.({ status: 'invalid', attempt, model, duration_ms, error: lastError })
    // Second attempt: show the model its answer and what was wrong with it.
    messages.push({ role: 'assistant', content }, { role: 'user', content: `That answer is invalid: ${lastError}. Return ONLY the corrected JSON array.` })
  }
  return { status: 'failed', from_cache: false, submissions: [], error: lastError }
}

// ---------------------------------------------------------------------------
// Summary line
// ---------------------------------------------------------------------------

const GENERIC = new Set(['genetics', 'diagnostics', 'laboratory', 'laboratories', 'center', 'centre', 'institute', 'research', 'inc', 'inc.', 'llc', 'l.l.c.'])
const WEAK = new Set(['clinical', 'molecular', 'medical', 'department'])

/**
 * "Labcorp Genetics (formerly Invitae), Labcorp" → "Labcorp"; "CeGaT Center for Human Genetics Tuebingen" → "CeGaT";
 * "Clinical Genetics, Tokyo Medical University" → "Tokyo Medical University".
 */
export function shortLab(lab: string): string {
  const parts = lab.replace(/\s*\([^)]*\)/g, '').split(',').map((p) => p.trim()).filter(Boolean)
  const first = parts[0] ?? lab
  const words = first.split(/\s+/)
  const cut = words.findIndex((w, i) => i > 0 && GENERIC.has(w.toLowerCase()))
  const short = cut > 0 ? words.slice(0, cut).join(' ') : first
  return WEAK.has(short.toLowerCase()) && parts[1] ? parts[1] : short
}

const SHORT_CLASS: Record<string, string> = { 'Uncertain significance': 'VUS' }

/** "Labcorp: Likely benign (2025-02-27) · Ambry: VUS (2026-04-15)" */
export function summarizeSubmissions(subs: Submission[]): string {
  return subs
    .map((s) => `${shortLab(s.lab)}: ${SHORT_CLASS[s.classification] ?? s.classification}${s.last_evaluated ? ` (${s.last_evaluated})` : ''}`)
    .join(' · ')
}
