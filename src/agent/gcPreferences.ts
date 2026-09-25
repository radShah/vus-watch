/**
 * The GC's preferences (data/gc_preferences.json). Trust changes are
 * versioned: every change is kept in trust_history and returned as an event.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEntry } from '../lib/labTrust.ts'
import type { GcPreferences, Specialty, TrustTier } from '../types.ts'

export const PREFS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'gc_preferences.json')

export const loadPrefs = (): GcPreferences => JSON.parse(readFileSync(PREFS, 'utf8')) as GcPreferences

export function savePrefs(prefs: GcPreferences): void {
  const tmp = `${PREFS}.tmp`
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n')
  renameSync(tmp, PREFS)
}

/** Add or update one entry; records the change in trust_history and returns the event to log (null if nothing changed). */
export function setTrust(
  prefs: GcPreferences,
  input: { lab: string; specialty: Specialty; tier: TrustTier; note: string },
  at = new Date().toISOString(),
): object | null {
  const lab = input.lab.trim()
  const note = input.note.trim()
  const entry = findEntry(prefs, lab, input.specialty)
  const old_tier = entry?.tier ?? null
  if (entry && entry.tier === input.tier && entry.note === note) return null
  if (entry) Object.assign(entry, { tier: input.tier, set_at: at, note })
  else prefs.lab_trust.push({ lab, specialty: input.specialty, tier: input.tier, set_at: at, note })
  const change = { lab: entry?.lab ?? lab, specialty: input.specialty, old_tier, new_tier: input.tier, at, note }
  prefs.trust_history.push(change)
  return { ts: at, event_type: 'trust_changed', ...change }
}
