/**
 * Letter video via Black Forest Labs FLUX 3 Video (image-to-video). Same patients as
 * fluxLetterImage.ts: the patient's gene as a helix, the variant's rung marked with an amber ?,
 * then sheets of data arrive and the mark becomes a green ✓.
 *
 * The first and last frames are drawn in code (exact gene position, ? and ✓), restyled by
 * FLUX.2 [pro], and pinned as keyframes; FLUX 3 Video only animates what happens in between.
 * The still image stays as the fallback, so deleting the .mp4 restores the old letter.
 *
 * Run: npx tsx src/agent/fluxLetterVideo.ts [--patient P121]   (generates any missing videos)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Caseload, Variant } from '../types.ts'
import { isBenignReclassification, letterVideoPath, proteinPosition } from '../lib/letters.ts'
import {
  DRAW_H,
  DRAW_W,
  HELIX_PAD,
  MARK_Y,
  POLL_MS,
  ROOT,
  check,
  generateImage,
  helix,
  httpError,
  pin,
  question,
  rasterize,
  sleep,
} from './fluxLetterImage.ts'

const ENDPOINT = 'https://api.bfl.ai/v1/flux-3-video'
const TIMEOUT_MS = 10 * 60 * 1000
const FAILED = new Set(['Error', 'Failed', 'Request Moderated', 'Content Moderated'])

// One panel: the helix on the left two thirds, open space on the right where the data lands.
const HELIX_X = 48
const HELIX_W = 1060
const STACK_X = 1200
const AMBER = '#e0a33a'
const GREEN = '#3f9b6a'

type State = 'uncertain' | 'benign'

const frac = (v: Variant) => {
  const p = proteinPosition(v)
  return p ? p.pos / p.length : 0.5
}

/** A small neat stack of paper sheets with ruled lines: the new evidence. */
function paperStack(): string {
  const sheets: string[] = []
  for (let i = 0; i < 5; i++) {
    const x = STACK_X + i * 6
    const y = 560 - i * 16
    const lines = [0, 1, 2, 3].map((k) => `<line x1="${x + 30}" y1="${y + 36 + k * 26}" x2="${x + 190}" y2="${y + 36 + k * 26}" stroke="#d9cfbd" stroke-width="6" stroke-linecap="round"/>`)
    sheets.push(`<rect x="${x}" y="${y}" width="220" height="150" rx="10" fill="#fffdf8" stroke="#e6dccb" stroke-width="3"/>${lines.join('')}`)
  }
  return sheets.join('')
}

/** This patient's gene as one helix; the variant's rung and pin in amber with ? or green with ✓. */
export function frameSvg(v: Variant, state: State): string {
  const color = state === 'uncertain' ? AMBER : GREEN
  const h = helix(HELIX_X, frac(v), color, HELIX_W)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_W}" height="${DRAW_H}" viewBox="0 0 ${DRAW_W} ${DRAW_H}">
<rect width="100%" height="100%" fill="#fbf6ee"/>
${h.svg}
${pin(h.rungX, h.rungTop, color, state === 'uncertain' ? question : check)}
${state === 'benign' ? paperStack() : ''}
</svg>`
}

/** The ? or ✓ redrawn on the restyled frame at the pin's exact position (FLUX tends to drop small symbols). */
function symbolSvg(v: Variant, state: State, restyledPng: Buffer): string {
  const x = HELIX_X + HELIX_PAD + frac(v) * (HELIX_W - 2 * HELIX_PAD)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_W}" height="${DRAW_H}" viewBox="0 0 ${DRAW_W} ${DRAW_H}">
<image href="data:image/png;base64,${restyledPng.toString('base64')}" width="${DRAW_W}" height="${DRAW_H}"/>
${state === 'uncertain' ? question(x, MARK_Y) : check(x, MARK_Y)}
</svg>`
}

const START_PROMPT = [
  "Restyle this diagram as a soft gouache-and-watercolor children's-book illustration on warm cream paper, with gentle hand-painted shading, calm and hopeful.",
  'The DNA strands become soft glossy ribbons. Keep the layout exactly the same: one DNA double helix on the left two thirds,',
  'one highlighted amber rung, and above it an amber circle with a white question mark on a thin stem; empty cream space on the right.',
  'Do not move, add or remove any shapes. No words, no text, no letters, no numbers, no people.',
].join(' ')

const END_PROMPT = [
  'Change only two things in this illustration: the highlighted amber rung and the amber circle above it become a calm green (#3f9b6a),',
  'with a white check mark in the circle instead of the question mark; and a small neat stack of cream paper sheets with faint ruled lines',
  'now sits in the empty space on the lower right. Keep everything else identical: same style, same helix, same positions.',
  'No words, no text, no letters, no numbers, no people.',
].join(' ')

const MOTION_PROMPT = [
  'Soft gouache-and-watercolor illustration, gently animated. Small sheets of paper and little data cards drift in one by one from the edges',
  'and settle into a neat stack on the right of the DNA helix. As the stack grows, the amber circle with the question mark calmly transforms',
  'into a green circle with a check mark, and the highlighted rung below it turns from amber to green. The helix itself stays still.',
  'Slow, calm, reassuring. No text, no people. Static camera.',
].join(' ')

/**
 * Draws the start and end frames, has FLUX.2 [pro] restyle the start and then derive the end from
 * it (so both match), redraws the ? and ✓, and saves them next to `out` as *.start.png, *.end.png.
 */
async function keyframes(apiKey: string, v: Variant, out: string) {
  const base = out.replace(/\.mp4$/, '')
  const f = (s: string) => `${base}.${s}.png`
  rasterize(frameSvg(v, 'uncertain'), f('start.drawn'))
  const a = await generateImage(apiKey, START_PROMPT, f('start.flux'), undefined, readFileSync(f('start.drawn')).toString('base64'))
  const b = await generateImage(apiKey, END_PROMPT, f('end.flux'), undefined, readFileSync(f('start.flux')).toString('base64'))
  rasterize(symbolSvg(v, 'uncertain', readFileSync(f('start.flux'))), f('start'))
  rasterize(symbolSvg(v, 'benign', readFileSync(f('end.flux'))), f('end'))
  return { start: f('start'), end: f('end'), cost: (a.cost ?? 0) + (b.cost ?? 0) }
}

/** Animates between the two keyframes with FLUX 3 Video and writes the MP4 to `out`. Returns the cost in credits. */
export async function generateVideo(apiKey: string, prompt: string, frames: [string, string], out: string) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      mode: 'i2v',
      prompt,
      keyframes: frames.map((p) => readFileSync(p).toString('base64')),
      duration: 6,
      aspect_ratio: '2:1',
      resolution: 'hd',
      generate_audio: false,
      safety_tolerance: 2,
    }),
  })
  if (!res.ok) throw await httpError(res)
  const job = (await res.json()) as { polling_url: string; cost?: number | null }

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS * 2)
    const poll = await fetch(job.polling_url, { headers: { 'x-key': apiKey, accept: 'application/json' } })
    if (!poll.ok) throw await httpError(poll)
    const body = (await poll.json()) as { status: string; result?: { sample?: string } | null }
    if (body.status === 'Ready') {
      if (!body.result?.sample) throw new Error('Ready but no result.sample')
      // Signed URL, short-lived: download immediately.
      const mp4 = await fetch(body.result.sample)
      if (!mp4.ok) throw new Error(`Download failed: HTTP ${mp4.status}`)
      writeFileSync(out, Buffer.from(await mp4.arrayBuffer()))
      return job.cost ?? null
    }
    if (FAILED.has(body.status)) throw new Error(`Video generation ended with status "${body.status}"`)
  }
  throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)
}

async function main() {
  process.loadEnvFile(join(ROOT, '.env'))
  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) throw new Error('BFL_API_KEY is not set (.env)')
  const i = process.argv.indexOf('--patient')
  const only = i > 0 ? process.argv[i + 1] : undefined

  const caseload = JSON.parse(readFileSync(join(ROOT, 'data', 'caseload.json'), 'utf8')) as Caseload
  const todo = caseload.patients
    .filter((p) => !only || p.id === only)
    .flatMap((p) => p.variants.filter(isBenignReclassification).map((v) => ({ p, v, out: join(ROOT, 'public', letterVideoPath(p.id, v.clinvar.variation_id).src) })))
  const missing = todo.filter((t) => !existsSync(t.out))
  console.log(`${todo.length} benign reclassification(s), ${missing.length} video(s) to generate`)

  for (const { p, v, out } of missing) {
    const k = await keyframes(apiKey, v, out)
    console.log(`keyframes ${p.id} ${v.gene}  cost=${k.cost}  ${relative(ROOT, k.start)} ${relative(ROOT, k.end)}`)
    const cost = await generateVideo(apiKey, MOTION_PROMPT, [k.start, k.end], out)
    console.log(`saved ${p.id} ${v.gene}  video cost=${cost ?? '?'}  ${relative(ROOT, out)}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error((err as Error).message)
    process.exit(1)
  })
}
