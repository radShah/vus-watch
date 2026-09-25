/**
 * Dev-server API (npm run dev) so the dashboard can save the GC's lab trust
 * list and her decisions. Writes the data files and logs events; the dashboard
 * re-renders when Vite hot-reloads the JSON.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { callKey, nextAction } from '../agent/decide.ts'
import { appendEvents } from '../agent/events.ts'
import { loadPrefs, savePrefs, setTrust } from '../agent/gcPreferences.ts'
import { SPECIALTIES, TIERS } from '../lib/labTrust.ts'
import type { Caseload, GcDecision, Specialty, TrustTier } from '../types.ts'

const CASELOAD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'caseload.json')
const GC_DECISIONS = ['approve', 'hold', 'dismiss'] as const

class BadRequest extends Error {}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new BadRequest('body is not JSON')
  }
}

const str = (v: unknown, name: string, required = true): string => {
  if (typeof v === 'string' && (v.trim() || !required)) return v.trim()
  if (!required && v == null) return ''
  throw new BadRequest(`${name} is required`)
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (allowed.includes(v as T)) return v as T
  throw new BadRequest(`${name} must be one of ${allowed.join(', ')}`)
}

function labTrust(body: Record<string, unknown>) {
  const prefs = loadPrefs()
  const event = setTrust(prefs, {
    lab: str(body.lab, 'lab'),
    specialty: oneOf<Specialty>(body.specialty, SPECIALTIES, 'specialty'),
    tier: oneOf<TrustTier>(body.tier, TIERS, 'tier'),
    note: str(body.note, 'note', false),
  })
  if (event) {
    savePrefs(prefs)
    appendEvents([event])
  }
  return prefs
}

function gcDecision(body: Record<string, unknown>) {
  const caseload = JSON.parse(readFileSync(CASELOAD, 'utf8')) as Caseload
  const patient = caseload.patients.find((p) => p.id === body.patient_id)
  if (!patient) throw new BadRequest('unknown patient_id')
  const variant = patient.variants.find((v) => v.clinvar.variation_id === body.variation_id)
  if (!variant) throw new BadRequest('unknown variation_id for this patient')
  const decision = oneOf(body.decision, GC_DECISIONS, 'decision')
  const d: GcDecision = {
    at: new Date().toISOString(),
    variation_id: variant.clinvar.variation_id,
    decision,
    reason: str(body.reason, 'reason', decision === 'hold'),
    ...(decision === 'hold' && body.until === 'established_lab' ? { until: 'established_lab' as const } : {}),
    calls_at_decision: (variant.clinvar.submissions ?? []).map(callKey),
  }
  patient.gc_decisions.push(d)
  // Reflect the decision now; the next cycle re-decides with it.
  variant.watch_status = decision === 'approve' ? 'closed' : decision === 'hold' ? 'active' : 'quiet'
  if (variant.decision) {
    const verb = { approve: 'You approved contacting the patient', hold: 'You put this on hold', dismiss: 'You dismissed this' }[decision]
    variant.decision = { ...variant.decision, action: decision === 'hold' ? 'hold' : 'quiet', urgent: false, reason: `${verb} on ${d.at.slice(0, 10)}${d.reason ? `: ${d.reason}` : ''}.`, decided_at: d.at }
  }
  patient.next_action = nextAction(patient) ?? patient.next_action
  const tmp = `${CASELOAD}.tmp`
  writeFileSync(tmp, JSON.stringify(caseload, null, 2) + '\n')
  renameSync(tmp, CASELOAD)
  appendEvents([{ ts: d.at, event_type: 'gc_decision', variation_id: d.variation_id, case_ids: [patient.id], decision, reason: d.reason, until: d.until ?? null }])
  return d
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function gcApi(): Plugin {
  return {
    name: 'vus-watch-gc-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          if (req.method === 'GET' && req.url === '/gc-preferences') return send(res, 200, loadPrefs())
          if (req.method === 'POST' && req.url === '/lab-trust') return send(res, 200, labTrust(await readJson(req)))
          if (req.method === 'POST' && req.url === '/gc-decision') return send(res, 200, gcDecision(await readJson(req)))
          send(res, 404, { error: 'not found' })
        } catch (e) {
          send(res, e instanceof BadRequest ? 400 : 500, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}
