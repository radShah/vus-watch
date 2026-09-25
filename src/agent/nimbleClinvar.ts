/**
 * Live ClinVar fetch via Nimble. Scrapes one ClinVar variation page with a CSS
 * parser and normalizes the fields with plain code. Uses Nimble's server-side
 * parsing when it returns fields; otherwise applies the same selectors locally
 * to the HTML Nimble returned (parser_path records which). The raw Nimble response is
 * written to .cache/nimble/ (gitignored) and never enters case state.
 *
 * Anything missing or unrecognized is "unknown". Never guessed.
 */
import Nimble from '@nimble-way/nimble-js'
import { parseHTML } from 'linkedom'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const UNKNOWN = 'unknown'

export const CLASSIFICATIONS = [
  'Pathogenic',
  'Likely pathogenic',
  'Uncertain significance',
  'Likely benign',
  'Benign',
  'Conflicting classifications of pathogenicity',
] as const

export interface ClinvarRecord {
  ok: boolean
  error?: string
  variation_id: string
  variant_name: string
  vcv_accession: string
  record_version: number | typeof UNKNOWN
  overall_classification: (typeof CLASSIFICATIONS)[number] | typeof UNKNOWN
  review_status: string
  record_last_updated: string
  submissions_table: string
  /** One labeled line per submission row, whitespace collapsed. Sent to Liquid for extraction. */
  submissions_text: string
  submission_rows: number
  fetched_at: string
  source_url: string
  raw_path?: string
  parser_path?: ParserPath
}

export type ParserPath = 'nimble_parser' | 'local_parser'

const css = (selector: string) => ({
  type: 'terminal',
  selector: { type: 'css', css_selector: selector },
  extractor: { type: 'text' },
})

const PARSER = {
  variant_name: css('h2.blue-box'),
  accession: css('.accession-info'),
  overall_classification: css('#germline-somatic-info .germline-section .single-item-value'),
  review_status: css('#germline-stars-icon p'),
  record_last_updated: css('.last-updated'),
  submissions_table: css('table#assertion-list tbody'),
}

type Field = keyof typeof PARSER

// ---------------------------------------------------------------------------
// Normalizers (pure)
// ---------------------------------------------------------------------------

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

/** "Accession: VCV003672027.3" → { vcv_accession: "VCV003672027", record_version: 3 } */
export function parseAccession(text: string): { vcv_accession: string; record_version: number | typeof UNKNOWN } {
  const m = /(VCV\d+)\.(\d+)/.exec(text)
  if (m) return { vcv_accession: m[1], record_version: Number(m[2]) }
  const vcv = /(VCV\d+)/.exec(text)?.[1]
  return { vcv_accession: vcv ?? UNKNOWN, record_version: UNKNOWN }
}

/** First line only, matched exactly (case-insensitive) to one of the six allowed values. */
export function normalizeClassification(text: string): ClinvarRecord['overall_classification'] {
  const first = (typeof text === 'string' ? text : '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const hit = CLASSIFICATIONS.find((c) => c.toLowerCase() === first.toLowerCase())
  return hit ?? UNKNOWN
}

/** Text before the first period. */
export function normalizeReviewStatus(text: string): string {
  const s = clean(text).split('.')[0].trim()
  return s || UNKNOWN
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "Record last updated Sep 10, 2026" → "2026-09-10". */
export function normalizeDate(text: string): string {
  const m = /([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(clean(text))
  if (!m) return UNKNOWN
  const mo = MONTHS.indexOf(m[1].toLowerCase())
  if (mo < 0) return UNKNOWN
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

let client: Nimble | null = null
function nimble(): Nimble {
  if (!process.env.NIMBLE_API_KEY) throw new Error('NIMBLE_API_KEY is not set (.env)')
  client ??= new Nimble({ apiKey: process.env.NIMBLE_API_KEY })
  return client
}

const CACHE_DIR = join(process.cwd(), '.cache', 'nimble')

/** Pull the parsed fields out of a Nimble response, wherever the SDK nests them. */
function nimbleFields(res: unknown): Partial<Record<Field, unknown>> {
  const parsing = (res as { data?: { parsing?: Record<string, unknown> } })?.data?.parsing
  if (!parsing) return {}
  const entities = parsing.entities as Record<string, unknown> | undefined
  return (entities && typeof entities === 'object' ? entities : parsing) as Partial<Record<Field, unknown>>
}

/** Apply the same six CSS selectors to the HTML Nimble returned. */
function localFields(html: string): Partial<Record<Field, unknown>> {
  const { document } = parseHTML(html)
  const out: Partial<Record<Field, unknown>> = {}
  for (const [k, def] of Object.entries(PARSER) as [Field, (typeof PARSER)[Field]][]) {
    const el = document.querySelector(def.selector.css_selector)
    if (el) out[k] = el.textContent ?? ''
  }
  return out
}

const SUBMISSION_CELLS = ['Classification (last evaluated)', 'Review status (assertion criteria)', 'Condition', 'Submitter', 'Details']

/** Submission rows of the germline table as labeled lines. Detail rows (tr.evidence-full-display) only repeat the comment. */
export function submissionRows(html: string): string[] {
  const { document } = parseHTML(html)
  return [...document.querySelectorAll('table#assertion-list tbody > tr.germline-sub-col')].map((tr, i) => {
    const cells = [...tr.querySelectorAll(':scope > td')].map((td) =>
      clean(td.textContent)
        .replace(/\bC Contributing to aggregate classification\b/, '')
        .replace(/Comment: show /, 'Comment: ')
        .replace(/\(less\)/g, '')
        .trim(),
    )
    const labeled = SUBMISSION_CELLS.map((label, k) => (cells[k] ? `${label}: ${cells[k]}` : '')).filter(Boolean)
    return `Row ${i + 1} | ${labeled.join(' | ')}`
  })
}

const hasAny = (f: Partial<Record<Field, unknown>>) => Object.values(f).some((v) => text(v).trim())

/** Nimble's server-side parsing when it returns anything; otherwise local parsing of the returned HTML. */
function parsedFields(res: unknown): { fields: Partial<Record<Field, unknown>>; parser_path: ParserPath } {
  const n = nimbleFields(res)
  if (hasAny(n)) return { fields: n, parser_path: 'nimble_parser' }
  const html = (res as { data?: { html?: string } })?.data?.html
  return { fields: html ? localFields(html) : {}, parser_path: 'local_parser' }
}

/** Terminal fields may come back as a string or a one-element array. */
const text = (v: unknown): string => (Array.isArray(v) ? v.map(String).join('\n') : typeof v === 'string' ? v : '')

export function emptyRecord(variationId: string, error?: string): ClinvarRecord {
  return {
    ok: false,
    error,
    variation_id: variationId,
    variant_name: UNKNOWN,
    vcv_accession: UNKNOWN,
    record_version: UNKNOWN,
    overall_classification: UNKNOWN,
    review_status: UNKNOWN,
    record_last_updated: UNKNOWN,
    submissions_table: UNKNOWN,
    submissions_text: UNKNOWN,
    submission_rows: 0,
    fetched_at: new Date().toISOString(),
    source_url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`,
  }
}

export async function fetchClinvarVariant(variationId: string): Promise<ClinvarRecord> {
  const rec = emptyRecord(variationId)
  let res: unknown
  try {
    // formats: html so the local parser has something to work on when Nimble's parsing comes back empty.
    res = await nimble().extract.run({ url: rec.source_url, render: true, parse: true, parser: PARSER, formats: ['html'] })
  } catch (e) {
    return { ...rec, error: e instanceof Error ? e.message : String(e) }
  }

  mkdirSync(CACHE_DIR, { recursive: true })
  const rawPath = join(CACHE_DIR, `${variationId}-${rec.fetched_at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(rawPath, JSON.stringify(res, null, 2))

  const { fields: f, parser_path } = parsedFields(res)
  const acc = parseAccession(text(f.accession))
  const out: ClinvarRecord = {
    ...rec,
    raw_path: rawPath,
    parser_path,
    variant_name: clean(text(f.variant_name)) || UNKNOWN,
    ...acc,
    overall_classification: normalizeClassification(text(f.overall_classification)),
    review_status: normalizeReviewStatus(text(f.review_status)),
    record_last_updated: normalizeDate(text(f.record_last_updated)),
    submissions_table: text(f.submissions_table).trim() || UNKNOWN,
  }
  const html = (res as { data?: { html?: string } })?.data?.html
  const rows = html ? submissionRows(html) : []
  out.submissions_text = rows.join('\n') || UNKNOWN
  out.submission_rows = rows.length
  // A fetch counts as ok only if we got the accession: proof we parsed the right page.
  out.ok = out.vcv_accession !== UNKNOWN
  if (!out.ok) out.error = `Nimble status ${(res as { status?: string })?.status ?? '?'}; no accession parsed`
  return out
}
