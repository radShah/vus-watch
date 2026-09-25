/**
 * Lab trust lookup (pure; used by decide.ts, the API and the dashboard).
 * A specialty-specific entry beats "all"; a lab with no entry is "standard".
 */
import type { ClinicArea, GcPreferences, LabTrust, Specialty, TrustUsed } from '../types.ts'

export const SPECIALTIES: Specialty[] = ['all', 'cancer', 'cardio', 'neuro']
export const TIERS = ['established', 'standard', 'low'] as const
export const DEFAULT_TIER = 'standard'

const DROP = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'gmbh'])

/** "Myriad Genetics, Inc." → "myriad genetics"; "Labcorp Genetics (formerly Invitae)" → "labcorp genetics". */
export function normalizeLab(lab: string): string {
  return lab
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !DROP.has(w))
    .join(' ')
}

/** A trust entry covers a ClinVar submitter when the submitter's normalized name is, or starts with, the entry's. */
export function labMatches(entryLab: string, submitter: string): boolean {
  const e = normalizeLab(entryLab)
  const s = normalizeLab(submitter)
  return !!e && (s === e || s.startsWith(`${e} `))
}

/**
 * For reasons and labels: "Labcorp Genetics (formerly Invitae), Labcorp" → "Labcorp Genetics";
 * "Myriad Genetics, Inc." → "Myriad Genetics"; "Clinical Genetics, Tokyo Medical University" unchanged.
 */
export function displayLab(lab: string): string {
  const [first, ...rest] = lab.replace(/\s*\([^)]*\)/g, '').split(',').map((p) => p.trim())
  // normalizeLab drops "Inc", "L.L.C." etc., so a part that is only a suffix is dropped too
  const keep = rest.filter((p) => normalizeLab(p) && !normalizeLab(first).startsWith(normalizeLab(p)))
  return [first, ...keep].join(', ')
}

export const specialtyOf = (area: ClinicArea): Specialty => area.toLowerCase() as Specialty

export function findEntry(prefs: GcPreferences, lab: string, specialty: Specialty): LabTrust | undefined {
  return prefs.lab_trust.find((e) => e.specialty === specialty && labMatches(e.lab, lab))
}

export function lookupTier(prefs: GcPreferences, lab: string, specialty: Specialty): TrustUsed {
  const specific = specialty === 'all' ? undefined : findEntry(prefs, lab, specialty)
  if (specific) return { lab, specialty, tier: specific.tier, source: 'specialty' }
  const all = findEntry(prefs, lab, 'all')
  if (all) return { lab, specialty, tier: all.tier, source: 'all' }
  return { lab, specialty, tier: DEFAULT_TIER, source: 'default' }
}
