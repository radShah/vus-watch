/**
 * What the agent does with each watched variant after a cycle. Deterministic
 * rules from a practicing genetic counselor; no AI. What matters is WHICH labs
 * changed their call and how much this GC trusts them for the case's
 * specialty. ClinVar review stars are not used.
 *
 * A "change" is a lab whose current call differs from the classification on
 * the patient's report. Every decision carries the trust tiers it used
 * (trust_snapshot), so we can always say why it was made.
 */
import { displayLab, labMatches, lookupTier, specialtyOf } from '../lib/labTrust.ts'
import type { Decision, DecisionAction, GcDecision, GcPreferences, Patient, Specialty, Submission, TrustUsed, Variant } from '../types.ts'

const isPLP = (c: string) => /^(likely )?pathogenic/i.test(c) && !/conflicting/i.test(c)
const isBLB = (c: string) => /^(likely )?benign/i.test(c)

export const callKey = (s: Submission) => `${s.lab}: ${s.classification}`

const day = (iso: string) => iso.slice(0, 10)
const tierLabel = (t: TrustUsed) => `${t.tier}, ${t.specialty}`

export function latestGcDecision(patient: Patient, variationId: string): GcDecision | undefined {
  return patient.gc_decisions.filter((d) => d.variation_id === variationId).at(-1)
}

/** "Re-evaluated: you set GeneDx to established (cardio) on 2026-09-25. " when a tier used last time has changed. */
function reevaluatedNote(prev: Decision | undefined, snapshot: TrustUsed[], prefs: GcPreferences, specialty: Specialty): string {
  if (!prev) return ''
  const notes: string[] = []
  for (const t of snapshot) {
    const before = prev.trust_snapshot.find((p) => p.lab === t.lab)
    if (!before || before.tier === t.tier) continue
    const change = prefs.trust_history
      .filter((h) => (h.specialty === specialty || h.specialty === 'all') && labMatches(h.lab, t.lab))
      .at(-1)
    notes.push(
      change
        ? `you set ${change.lab} to ${change.new_tier} (${change.specialty}) on ${day(change.at)}`
        : `${displayLab(t.lab)} is now ${t.tier} (${t.specialty})`,
    )
  }
  return notes.length ? `Re-evaluated: ${notes.join('; ')}. ` : ''
}

/**
 * @param readOk false when ClinVar couldn't be fetched this cycle.
 */
export function decide(patient: Patient, variant: Variant, prefs: GcPreferences, opts: { now: string; readOk: boolean }): Decision {
  const specialty = specialtyOf(patient.clinic_area)
  const c = variant.clinvar
  const subs = c.submissions ?? []
  const snapshot = [...new Map(subs.map((s) => [s.lab, lookupTier(prefs, s.lab, specialty)])).values()]
  const tierOf = (s: Submission) => snapshot.find((t) => t.lab === s.lab)!
  const out = (action: DecisionAction, reason: string): Decision => ({
    action,
    reason: reevaluatedNote(variant.decision, snapshot, prefs, specialty) + reason,
    urgent: action === 'flag_upgrade',
    trust_snapshot: snapshot,
    decided_at: opts.now,
  })

  // Never guess from a record we couldn't read.
  if (!opts.readOk || c.extraction_status !== 'ok' || !subs.length) return out('recheck', "Couldn't read ClinVar; retrying next cycle.")

  const reported = variant.reported_classification.classification
  const gc = latestGcDecision(patient, c.variation_id)
  const isNew = (s: Submission) => !gc || !gc.calls_at_decision.includes(callKey(s))
  let changed = subs.filter((s) => s.classification !== reported)

  // Upgrades always get individual GC review, whatever the lab's tier; one the GC already decided on is not re-flagged.
  const upgrades = isPLP(reported) ? [] : changed.filter((s) => isPLP(s.classification) && isNew(s))
  if (upgrades.length)
    return out(
      'flag_upgrade',
      `URGENT: ${upgrades
        .map((s) => `${displayLab(s.lab)} (${tierLabel(tierOf(s))}) now calls it ${s.classification}` + (s.evidence_tags.length ? ` [evidence: ${s.evidence_tags.map((t) => t.replace(/_/g, ' ')).join(', ')}]` : ' [no evidence tags]'))
        .join('; ')}.`,
    )

  const benignFromEstablished = (list: Submission[]) =>
    isBLB(reported) ? [] : list.filter((s) => isBLB(s.classification) && tierOf(s).tier === 'established')
  const describe = (list: Submission[]) => list.map((s) => `${displayLab(s.lab)} (${tierLabel(tierOf(s))})`).join(', ')
  const others = (list: Submission[]) => {
    const rest = subs.filter((s) => !list.includes(s) && s.classification !== list[0]?.classification)
    return rest.length ? ` Other labs: ${rest.map((s) => `${displayLab(s.lab)} ${s.classification}`).join(', ')}.` : ''
  }

  if (gc) {
    const since = day(gc.at)
    if (gc.decision === 'hold' && gc.until === 'established_lab') {
      const est = benignFromEstablished(changed)
      if (est.length)
        return out('flag_downgrade', `Your hold from ${since} is released: ${est.map((s) => `${displayLab(s.lab)} (${tierLabel(tierOf(s))}) now calls it ${s.classification}`).join('; ')}.${others(est)}`)
      return out('hold', `Holding per your decision on ${since} until an established lab weighs in${gc.reason ? ` (${gc.reason})` : ''}.`)
    }
    const fresh = changed.filter(isNew)
    if (!fresh.length) {
      if (gc.decision === 'hold') return out('hold', `Holding per your decision on ${since}${gc.reason ? `: ${gc.reason}` : ''}. No new lab calls since.`)
      if (gc.decision === 'dismiss') return out('quiet', `You dismissed this on ${since}; no new lab calls since.`)
      return out('quiet', `You approved contacting the patient on ${since}; no new lab calls since.`)
    }
    // Something new since the GC's decision: evaluate only the new calls.
    changed = fresh
  }

  const est = benignFromEstablished(changed)
  if (est.length)
    return out('flag_downgrade', `${est.map((s) => `${displayLab(s.lab)} (${tierLabel(tierOf(s))}) now calls it ${s.classification}`).join('; ')}.${others(est)}`)

  if (changed.length) {
    const trusted = changed.filter((s) => tierOf(s).tier === 'established')
    return out(
      'hold',
      trusted.length
        ? `Held: ${changed.map((s) => `${displayLab(s.lab)} (${tierLabel(tierOf(s))}) calls it ${s.classification}`).join(', ')}; no benign call from an established lab.`
        : `Held: only ${describe(changed)} changed; watching for established labs.`,
    )
  }

  return out('quiet', `No change since ${gc ? day(gc.at) : variant.reported_classification.date}.`)
}

const PRIORITY: DecisionAction[] = ['flag_upgrade', 'flag_downgrade', 'recheck', 'hold', 'quiet']

/** Write a decision onto the variant; watch status follows the action. */
export function applyDecision(patient: Patient, variant: Variant, d: Decision): void {
  variant.decision = d
  if (d.action === 'flag_downgrade' || d.action === 'flag_upgrade') variant.watch_status = 'waiting_on_gc'
  else if (d.action === 'hold' || d.action === 'recheck') variant.watch_status = 'active'
  else if (variant.watch_status === 'active' || variant.watch_status === 'waiting_on_gc')
    // quiet: nothing is waiting on the GC. After a GC approval the case is closed until something new appears.
    variant.watch_status = latestGcDecision(patient, variant.clinvar.variation_id)?.decision === 'approve' ? 'closed' : 'quiet'
}

/** The patient's next action, from the most urgent decision among their variants. */
export function nextAction(patient: Patient): string | null {
  const decided = patient.variants.filter((v) => v.decision)
  if (!decided.length) return null
  const v = decided.sort((a, b) => PRIORITY.indexOf(a.decision!.action) - PRIORITY.indexOf(b.decision!.action))[0]
  const gc = latestGcDecision(patient, v.clinvar.variation_id)
  switch (v.decision!.action) {
    case 'flag_upgrade':
      return 'URGENT: review upgrade → contact patient'
    case 'flag_downgrade':
      return 'Review likely downgrade → patient letter'
    case 'recheck':
      return 'Recheck ClinVar next cycle'
    case 'hold':
      return gc?.decision === 'hold' ? 'On hold (your decision)' : 'Watch for an established lab'
    case 'quiet':
      return gc?.decision === 'approve' ? 'Contact patient' : 'Routine ClinVar recheck'
  }
}
