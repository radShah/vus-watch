import type { Variant } from '../types.ts'

const BENIGN = new Set(['Benign', 'Likely benign', 'Benign/Likely benign'])

/** True when the lab reported a VUS and ClinVar now calls it benign or likely benign. */
export function isBenignReclassification(v: Variant): boolean {
  return v.reported_classification.classification === 'Uncertain significance' && BENIGN.has(v.clinvar.classification)
}

/** Where the FLUX letter image for one variant is served from (written by src/agent/fluxLetterImage.ts). */
export function letterImagePath(patientId: string, variationId: string): string {
  return `/letters/${patientId}-${variationId}.png`
}

/** Where the FLUX letter video is served from (written by src/agent/fluxLetterVideo.ts); its first frame is `poster`. */
export function letterVideoPath(patientId: string, variationId: string): { src: string; poster: string } {
  return { src: `/letters/${patientId}-${variationId}.mp4`, poster: `/letters/${patientId}-${variationId}.start.png` }
}

/** Protein length in amino acids, checked on NCBI Protein. Genes not listed get no position claim. */
export const PROTEIN_LENGTH: Record<string, number> = {
  BRCA2: 3418, // NP_000050.3
}

/** Where the variant sits along the protein, from the p. change in its HGVS name (p.Asp2983Val → 2983), or null. */
export function proteinPosition(v: Variant): { pos: number; length: number } | null {
  const m = v.hgvs.match(/\(p\.[A-Z][a-z]{2}(\d+)/)
  const length = PROTEIN_LENGTH[v.gene]
  if (!m || !length) return null
  const pos = Number(m[1])
  return pos >= 1 && pos <= length ? { pos, length } : null
}
