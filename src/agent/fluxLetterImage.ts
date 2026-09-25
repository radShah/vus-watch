/**
 * Letter illustrations via Black Forest Labs FLUX.2 [pro]. When a variant the
 * lab reported as a VUS is now benign or likely benign on ClinVar, the agent
 * drafts a recontact letter and generates a calm header image for it. The GC
 * approves the image together with the letter in the patient drawer.
 *
 * Images are saved to public/letters/{patientId}-{variationId}.png so the
 * dashboard can show them without calling the API during a demo.
 *
 * Run: npx tsx src/agent/fluxLetterImage.ts   (generates any missing images)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Caseload, Variant } from '../types.ts'
import { isBenignReclassification, letterImagePath, proteinPosition } from '../lib/letters.ts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(ROOT, 'public', 'letters')
const ENDPOINT = 'https://api.bfl.ai/v1/flux-2-pro'
const WIDTH = 1536 // 16:9, multiples of 16
const HEIGHT = 864
export const POLL_MS = 1500
const TIMEOUT_MS = 3 * 60 * 1000
export const PENDING = new Set(['Pending', 'Reasoning', 'Generating'])
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Drawings are 2:1 so the before/after fills the frame; FLUX edits keep the input's size.
export const DRAW_W = 1536
export const DRAW_H = 768
const CARD_W = 672
const CARDS = [
  { x: 48, tint: '#fdf0dc' }, // then: uncertain
  { x: DRAW_W - 48 - CARD_W, tint: '#e3f3ea' }, // now: benign / likely benign
]
export const HELIX_PAD = 56
const HELIX_Y = 480
const HELIX_AMP = 70
const HELIX_WAVE = 205
export const MARK_Y = 210

/** A DNA double helix across one card; the variant's rung at `frac` is drawn in `color`. */
export function helix(x0: number, frac: number, color: string, width = CARD_W): { svg: string; rungTop: number; rungX: number } {
  const len = width - 2 * HELIX_PAD
  const left = x0 + HELIX_PAD
  const yA = (x: number) => HELIX_Y + HELIX_AMP * Math.sin((2 * Math.PI * (x - left)) / HELIX_WAVE)
  const yB = (x: number) => 2 * HELIX_Y - yA(x)
  const strand = (y: (x: number) => number) => {
    const pts: string[] = []
    for (let x = left; x <= left + len; x += 6) pts.push(`${x.toFixed(1)},${y(x).toFixed(1)}`)
    return pts.join(' ')
  }
  const rungs: string[] = []
  for (let x = left + 11; x < left + len; x += 22)
    rungs.push(`<line x1="${x}" y1="${yA(x)}" x2="${x}" y2="${yB(x)}" stroke="#cdd9d3" stroke-width="5" stroke-linecap="round"/>`)
  const rungX = left + frac * len
  const rungTop = Math.min(yA(rungX), yB(rungX))
  const svg = `${rungs.join('')}
<polyline points="${strand(yB)}" fill="none" stroke="#9cc5a1" stroke-width="14" stroke-linecap="round"/>
<polyline points="${strand(yA)}" fill="none" stroke="#2f8f8a" stroke-width="14" stroke-linecap="round"/>
<line x1="${rungX}" y1="${yA(rungX)}" x2="${rungX}" y2="${yB(rungX)}" stroke="${color}" stroke-width="14" stroke-linecap="round"/>`
  return { svg, rungTop, rungX }
}

/** A marker pinned above the variant's rung, with `symbol` drawn as white strokes on it. */
export function pin(x: number, rungTop: number, color: string, symbol: (cx: number, cy: number) => string): string {
  return `<line x1="${x}" y1="${MARK_Y + 72}" x2="${x}" y2="${rungTop}" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
<circle cx="${x}" cy="${MARK_Y}" r="72" fill="${color}"/>
${symbol(x, MARK_Y)}`
}

export const question = (cx: number, cy: number) =>
  `<path d="M ${cx - 22} ${cy - 18} C ${cx - 22} ${cy - 50} ${cx + 25} ${cy - 50} ${cx + 25} ${cy - 18} C ${cx + 25} ${cy} ${cx} ${cy + 2} ${cx} ${cy + 16}" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/>
<circle cx="${cx}" cy="${cy + 38}" r="8" fill="#fff"/>`

export const check = (cx: number, cy: number) =>
  `<path d="M ${cx - 30} ${cy + 2} L ${cx - 8} ${cy + 25} L ${cx + 32} ${cy - 22}" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`

/**
 * This patient's gene as a DNA helix, twice: on the left card (as reported) the variant's rung
 * is amber with a question mark; on the right card (now) the same rung is green with a check.
 * The rung sits at the variant's real protein position when known. Drawn exactly in code; FLUX
 * only restyles it, because text-to-image can't be trusted to place things. No text: the
 * dashboard prints the gene, variant and dates around the image.
 */
export function variantSvg(v: Variant): string {
  const p = proteinPosition(v)
  const frac = p ? p.pos / p.length : 0.5
  const [then, now] = CARDS
  const a = helix(then.x, frac, '#e0a33a')
  const b = helix(now.x, frac, '#3f9b6a')
  const ax1 = then.x + CARD_W + 14
  const ax2 = now.x - 14
  const ay = HELIX_Y
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_W}" height="${DRAW_H}" viewBox="0 0 ${DRAW_W} ${DRAW_H}">
<defs><filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#8a7a5a" flood-opacity="0.18"/></filter></defs>
<rect width="100%" height="100%" fill="#fbf6ee"/>
${CARDS.map((c) => `<rect x="${c.x}" y="64" width="${CARD_W}" height="640" rx="48" fill="${c.tint}" filter="url(#s)"/>`).join('')}
${a.svg}
${b.svg}
${pin(a.rungX, a.rungTop, '#e0a33a', question)}
${pin(b.rungX, b.rungTop, '#3f9b6a', check)}
<path d="M ${ax1} ${ay} L ${ax2} ${ay} M ${ax2 - 20} ${ay - 18} L ${ax2} ${ay} L ${ax2 - 20} ${ay + 18}" fill="none" stroke="#8aa9a0" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
}

const EDIT_PROMPT = [
  "Restyle this diagram as a soft gouache-and-watercolor children's-book illustration on warm cream paper, with gentle hand-painted shading, calm and hopeful.",
  'The DNA strands become soft glossy ribbons. Keep the layout exactly the same: two rounded cards side by side (warm cream on the left, soft mint on the right),',
  'each with one DNA double helix in the same position; one highlighted rung at the same spot in both helixes, amber on the left and green on the right;',
  'above it on the left an amber circle with a white question mark, on the right a green circle with a white check mark;',
  'and a small arrow between the cards pointing from left to right.',
  'Do not move, add or remove any shapes. No words, no text, no letters, no numbers, no people.',
].join(' ')

/** Renders the SVG to PNG with headless Chrome (no image libraries in this repo). */
export function rasterize(svg: string, out: string) {
  const svgPath = out.replace(/\.png$/, '.svg')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(svgPath, svg)
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${DRAW_W},${DRAW_H}`, `--screenshot=${out}`, `file://${svgPath}`], { stdio: 'ignore' })
}

/**
 * The question mark and check drawn on top of the restyled image, at the markers' exact
 * positions (FLUX keeps the input's size and layout but tends to drop small symbols).
 */
export function symbolsSvg(v: Variant, restyledPng: Buffer): string {
  const p = proteinPosition(v)
  const frac = p ? p.pos / p.length : 0.5
  const [then, now] = CARDS.map((c) => c.x + HELIX_PAD + frac * (CARD_W - 2 * HELIX_PAD))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_W}" height="${DRAW_H}" viewBox="0 0 ${DRAW_W} ${DRAW_H}">
<image href="data:image/png;base64,${restyledPng.toString('base64')}" width="${DRAW_W}" height="${DRAW_H}"/>
${question(then, MARK_Y)}
${check(now, MARK_Y)}
</svg>`
}

/**
 * Draws this patient's gene and variant exactly, has FLUX.2 [pro] restyle it, then draws the
 * question mark and check back on. Keeps the steps next to `out` as *.drawn.png and *.flux.png.
 */
export async function generateLetterImage(apiKey: string, v: Variant, out: string) {
  const drawn = out.replace(/\.png$/, '.drawn.png')
  const flux = out.replace(/\.png$/, '.flux.png')
  rasterize(variantSvg(v), drawn)
  const result = await generateImage(apiKey, EDIT_PROMPT, flux, undefined, readFileSync(drawn).toString('base64'))
  rasterize(symbolsSvg(v, readFileSync(flux)), out)
  return result
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function httpError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '')
  if (res.status === 402) return new Error('402 Insufficient credits: check your BFL balance')
  if (res.status === 401 || res.status === 403) return new Error(`${res.status}: BFL_API_KEY rejected. ${body}`)
  return new Error(`HTTP ${res.status}: ${body}`)
}

/** Generates one image and writes it to `out`. Returns the seed and cost in credits (1 credit = $0.01). */
export async function generateImage(
  apiKey: string,
  prompt: string,
  out: string,
  seed = Math.floor(Math.random() * 2 ** 31),
  inputImage?: string,
) {
  // With an input image FLUX edits it and keeps its size; without one it generates at WIDTH×HEIGHT.
  const size = inputImage ? { input_image: inputImage } : { width: WIDTH, height: HEIGHT }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, ...size, seed, output_format: 'png', safety_tolerance: 2 }),
  })
  if (!res.ok) throw await httpError(res)
  const job = (await res.json()) as { polling_url: string; cost?: number | null }

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const poll = await fetch(job.polling_url, { headers: { 'x-key': apiKey, accept: 'application/json' } })
    if (!poll.ok) throw await httpError(poll)
    const body = (await poll.json()) as { status: string; result?: { sample?: string } | null }
    if (body.status === 'Ready') {
      if (!body.result?.sample) throw new Error('Ready but no result.sample')
      // The signed sample URL is only valid for 10 minutes, so download immediately.
      const img = await fetch(body.result.sample)
      if (!img.ok) throw new Error(`Download failed: HTTP ${img.status}`)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, Buffer.from(await img.arrayBuffer()))
      return { seed, cost: job.cost ?? null }
    }
    if (!PENDING.has(body.status)) throw new Error(`Generation ended with status "${body.status}"`)
  }
  throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)
}

async function main() {
  process.loadEnvFile(join(ROOT, '.env'))
  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) throw new Error('BFL_API_KEY is not set (.env)')

  const caseload = JSON.parse(readFileSync(join(ROOT, 'data', 'caseload.json'), 'utf8')) as Caseload
  const todo = caseload.patients.flatMap((p) =>
    p.variants.filter(isBenignReclassification).map((v) => ({ p, v, out: join(ROOT, 'public', letterImagePath(p.id, v.clinvar.variation_id)) })),
  )
  const missing = todo.filter((t) => !existsSync(t.out))
  console.log(`${todo.length} benign reclassification(s), ${missing.length} image(s) to generate`)

  for (const { p, v, out } of missing) {
    const { seed, cost } = await generateLetterImage(apiKey, v, out)
    console.log(`saved ${p.id} ${v.gene}  seed=${seed}  cost=${cost ?? '?'}  ${relative(ROOT, out)}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT_DIR, { recursive: true })
  main().catch((err) => {
    console.error((err as Error).message)
    process.exit(1)
  })
}
