/**
 * Generates 4 candidate header illustrations for "good news" patient letters
 * (a variant reclassified as benign) with Black Forest Labs FLUX.2 [pro].
 *
 * Run: npx tsx scripts/generate-letter-image.ts
 *
 * Needs BFL_API_KEY in .env and BFL credits on the account.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'letters', 'candidates')
const ENDPOINT = 'https://api.bfl.ai/v1/flux-2-pro'
const COUNT = 4
const WIDTH = 1536 // 16:9, multiples of 16
const HEIGHT = 864
const POLL_MS = 1500
const TIMEOUT_MS = 3 * 60 * 1000

const PROMPT =
  'Soft, calm, minimal illustration for a patient letter from a genetics clinic. An open recipe book on a warm kitchen table, one small highlighted letter on the page gently marked with a small green checkmark. Warm, reassuring pastel colors, flat vector style, lots of white space, friendly and hopeful mood. No words, no text, no letters, no numbers, no people\'s faces, nothing medical or clinical-looking.'

process.loadEnvFile(join(ROOT, '.env'))
const API_KEY = process.env.BFL_API_KEY
if (!API_KEY) throw new Error('BFL_API_KEY is not set (.env)')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PENDING = new Set(['Pending', 'Reasoning', 'Generating'])

interface SubmitResponse {
  id: string
  polling_url: string
  cost?: number | null
}

interface PollResponse {
  status: string
  result?: { sample?: string } | null
}

async function httpError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '')
  if (res.status === 402) return new Error('402 Insufficient credits: check your BFL balance or the hackathon credit grant')
  if (res.status === 401 || res.status === 403)
    return new Error(`${res.status}: BFL_API_KEY rejected or no access to flux-2-pro. ${body}`)
  return new Error(`HTTP ${res.status}: ${body}`)
}

async function submit(seed: number): Promise<SubmitResponse> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      prompt: PROMPT,
      width: WIDTH,
      height: HEIGHT,
      seed,
      output_format: 'png',
      safety_tolerance: 2,
    }),
  })
  if (!res.ok) throw await httpError(res)
  return (await res.json()) as SubmitResponse
}

async function waitForSample(pollingUrl: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const res = await fetch(pollingUrl, { headers: { 'x-key': API_KEY!, accept: 'application/json' } })
    if (!res.ok) throw await httpError(res)
    const poll = (await res.json()) as PollResponse
    if (poll.status === 'Ready') {
      if (!poll.result?.sample) throw new Error('Ready but no result.sample')
      return poll.result.sample
    }
    if (!PENDING.has(poll.status)) throw new Error(`Generation ended with status "${poll.status}"`)
  }
  throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)
}

// The signed sample URL is only valid for 10 minutes, so download immediately.
async function finish(n: number, seed: number, job: SubmitResponse): Promise<void> {
  const sample = await waitForSample(job.polling_url)
  const res = await fetch(sample)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const out = join(OUT_DIR, `benign-reassurance-${n}.png`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  console.log(`saved #${n}  seed=${seed}  cost=${job.cost ?? '?'}  ${relative(ROOT, out)}`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const seeds = Array.from({ length: COUNT }, () => Math.floor(Math.random() * 2 ** 31))

  // Submit one first so an empty or unauthorized account fails once, not four times.
  let first: SubmitResponse
  try {
    first = await submit(seeds[0])
  } catch (err) {
    console.error(`#1 failed to submit: ${(err as Error).message}`)
    process.exit(1)
  }

  const jobs: Promise<void>[] = [finish(1, seeds[0], first)]
  for (let i = 1; i < COUNT; i++) {
    const n = i + 1
    jobs.push(submit(seeds[i]).then((job) => finish(n, seeds[i], job)))
  }

  const results = await Promise.allSettled(jobs)
  let failed = 0
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed++
      console.error(`#${i + 1} failed (seed=${seeds[i]}): ${(r.reason as Error).message}`)
    }
  })
  console.log(`${COUNT - failed}/${COUNT} images saved`)
  if (failed) process.exit(1)
}

main()
