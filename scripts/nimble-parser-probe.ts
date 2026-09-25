/**
 * Probe for issue #1: does Nimble's server-side parsing return anything?
 * Each variant changes one thing from the docs example and prints the task ID,
 * status and data.parsing. HTML is not printed.
 *
 * Run: npx tsx scripts/nimble-parser-probe.ts
 */
import Nimble from '@nimble-way/nimble-js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARSER } from '../src/agent/nimbleClinvar.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
process.loadEnvFile(join(ROOT, '.env'))
const nimble = new Nimble({ apiKey: process.env.NIMBLE_API_KEY })

const EXAMPLE = 'https://example.com'
const CLINVAR = 'https://www.ncbi.nlm.nih.gov/clinvar/variation/4957498/'
const h1 = (selector: object, extractor: object = { type: 'text' }, type = 'terminal') => ({ title: { type, selector, extractor } })
const cssH1 = { type: 'css', css_selector: 'h1' }

const VARIANTS: [string, string, Record<string, unknown>][] = [
  ['A', 'docs example: h1 css/text, render:true', { url: EXAMPLE, render: true, parse: true, parser: h1(cssH1) }],
  ['B', 'render:false', { url: EXAMPLE, render: false, parse: true, parser: h1(cssH1) }],
  ['C', 'xpath //h1', { url: EXAMPLE, render: true, parse: true, parser: h1({ type: 'xpath', path: '//h1' }) }],
  ['D', 'terminal_list', { url: EXAMPLE, render: true, parse: true, parser: h1(cssH1, { type: 'text' }, 'terminal_list') }],
  ['E', 'extractor raw', { url: EXAMPLE, render: true, parse: true, parser: h1(cssH1, { type: 'raw' }) }],
  ['F', 'parse:true, no parser', { url: EXAMPLE, render: true, parse: true }],
  ['G', 'ClinVar, full PARSER, formats html', { url: CLINVAR, render: true, parse: true, parser: PARSER, formats: ['html'] }],
]

for (const [id, label, body] of VARIANTS) {
  try {
    const res = (await nimble.extract.run(body as never)) as unknown as {
      task_id?: string
      status?: string
      status_code?: number
      data?: Record<string, unknown>
    }
    console.log(
      `${id} | ${label} | task ${res.task_id} | ${res.status} ${res.status_code ?? ''} | data keys ${Object.keys(res.data ?? {}).join(',')} | parsing ${JSON.stringify(res.data?.parsing)?.slice(0, 300)}`,
    )
  } catch (e) {
    console.log(`${id} | ${label} | ERROR ${e instanceof Error ? e.message : String(e)}`)
  }
}
