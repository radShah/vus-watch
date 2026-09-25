/**
 * Builds data/caseload.json: a FICTIONAL genetic counseling caseload whose
 * variants are REAL public ClinVar records fetched from NCBI E-utilities.
 *
 * Run: npm run seed
 *
 * Patients, names, MRNs, providers and the "reported" (lab) classifications are
 * made up. Variant names, VCV IDs and current ClinVar classifications are real.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'caseload.json')
const CACHE = join(ROOT, 'scripts', 'fallback-variants.json')
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const REQUIRED_ID = '3672027' // NM_001134407.3(GRIN2A):c.1152C>A (p.Ser384Arg) — conflicting

// ---------------------------------------------------------------------------
// Clinic areas and genes
// ---------------------------------------------------------------------------

type Area = 'Cancer' | 'Cardio' | 'Neuro'

const GENES: Record<Area, string[]> = {
  Cancer: ['BRCA1', 'BRCA2', 'ATM', 'CHEK2', 'PALB2', 'MLH1', 'MSH2', 'MSH6', 'PMS2'],
  Cardio: ['MYH7', 'MYBPC3', 'KCNQ1', 'SCN5A'],
  Neuro: ['GRIN2A', 'SCN1A', 'CDKL5'],
}
const CONFLICT_GENES = ['BRCA2', 'ATM', 'CHEK2', 'PALB2', 'MSH6', 'MYBPC3', 'SCN5A', 'GRIN2A', 'SCN1A']
const PATHOGENIC_GENES = ['BRCA1', 'BRCA2', 'CHEK2', 'MLH1', 'MSH2', 'MYBPC3', 'MYH7', 'SCN1A']

const areaOf = (gene: string): Area =>
  (Object.keys(GENES) as Area[]).find((a) => GENES[a].includes(gene)) ?? 'Cancer'

// ---------------------------------------------------------------------------
// ClinVar fetching
// ---------------------------------------------------------------------------

export interface ClinVarRecord {
  variation_id: string
  accession: string
  title: string
  gene: string
  classification: string
  review_status: string
  last_evaluated: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(400) // stay under NCBI's 3 requests/second without a key
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
      console.warn(`  HTTP ${res.status} for ${url}`)
    } catch (err) {
      console.warn(`  fetch error: ${(err as Error).message}`)
    }
    await sleep(1000)
  }
  throw new Error(`E-utilities request failed: ${url}`)
}

async function esearch(gene: string, property: string, retmax = 20): Promise<string[]> {
  const term = `${gene}[gene] AND "${property}"[Properties]`
  const url = `${EUTILS}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmax=${retmax}&retmode=json`
  const data = await getJson(url)
  return data.esearchresult?.idlist ?? []
}

async function esummary(ids: string[]): Promise<ClinVarRecord[]> {
  const out: ClinVarRecord[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const data = await getJson(`${EUTILS}/esummary.fcgi?db=clinvar&id=${batch.join(',')}&retmode=json`)
    for (const id of data.result?.uids ?? []) {
      const r = data.result[id]
      const gc = r.germline_classification ?? {}
      const genes: string[] = (r.genes ?? []).map((g: { symbol: string }) => g.symbol)
      const titleGene = /\(([A-Z0-9]+)\):/.exec(r.title ?? '')?.[1]
      out.push({
        variation_id: id,
        accession: r.accession,
        title: r.title,
        gene: titleGene ?? genes[0] ?? '',
        classification: gc.description ?? '',
        review_status: gc.review_status ?? '',
        last_evaluated: gc.last_evaluated ? gc.last_evaluated.slice(0, 10).replaceAll('/', '-') : null,
      })
    }
  }
  return out
}

/** Keep only single-gene, transcript-level coding variants (c. and p. notation). */
const usable = (r: ClinVarRecord, gene: string) =>
  r.gene === gene && /^N[MR]_\d+\.\d+\([A-Z0-9]+\):c\./.test(r.title) && r.classification !== ''

async function fetchVariants(): Promise<ClinVarRecord[]> {
  const queries: { gene: string; property: string }[] = []
  for (const genes of Object.values(GENES)) for (const gene of genes) queries.push({ gene, property: 'clinsig vus' })
  for (const gene of CONFLICT_GENES) queries.push({ gene, property: 'clinsig has conflicts' })
  for (const gene of PATHOGENIC_GENES) queries.push({ gene, property: 'clinsig pathogenic' })

  const idsByGene = new Map<string, Set<string>>()
  for (const q of queries) {
    const ids = await esearch(q.gene, q.property)
    console.log(`  esearch ${q.gene.padEnd(7)} ${q.property.padEnd(22)} → ${ids.length} ids`)
    if (!idsByGene.has(q.gene)) idsByGene.set(q.gene, new Set())
    ids.forEach((id) => idsByGene.get(q.gene)!.add(id))
  }
  idsByGene.get('GRIN2A')!.add(REQUIRED_ID)

  const all = [...new Set([...idsByGene.values()].flatMap((s) => [...s]))]
  const records = await esummary(all)
  return records.filter((r) => usable(r, r.gene) && idsByGene.get(r.gene)?.has(r.variation_id))
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export type ClassCategory =
  | 'Pathogenic'
  | 'Likely pathogenic'
  | 'Uncertain significance'
  | 'Conflicting'
  | 'Likely benign'
  | 'Benign'
  | 'Other'

export function normalize(desc: string): ClassCategory {
  const d = desc.toLowerCase()
  if (d.includes('conflicting')) return 'Conflicting'
  if (d.startsWith('pathogenic/likely pathogenic')) return 'Likely pathogenic'
  if (d.startsWith('pathogenic')) return 'Pathogenic'
  if (d.startsWith('likely pathogenic')) return 'Likely pathogenic'
  if (d.startsWith('uncertain significance')) return 'Uncertain significance'
  if (d.startsWith('benign/likely benign') || d.startsWith('likely benign')) return 'Likely benign'
  if (d.startsWith('benign')) return 'Benign'
  return 'Other'
}

/** Clinically meaningful tier: an LP ↔ P shift doesn't change management, so it isn't a reclassification here. */
export function tier(desc: string): 'P/LP' | 'VUS' | 'Conflicting' | 'B/LB' | 'Other' {
  const c = normalize(desc)
  if (c === 'Pathogenic' || c === 'Likely pathogenic') return 'P/LP'
  if (c === 'Likely benign' || c === 'Benign') return 'B/LB'
  if (c === 'Uncertain significance') return 'VUS'
  return c
}

const isMissense = (title: string) => /\(p\.[A-Z][a-z]{2}\d+(?!Ter)[A-Z][a-z]{2}\)$/.test(title)

// ---------------------------------------------------------------------------
// Deterministic fake-patient generation
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260925)
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const FIRST_F = ['Ana', 'Beatriz', 'Chloe', 'Deepa', 'Elena', 'Fatima', 'Grace', 'Hana', 'Imani', 'Julia', 'Keiko', 'Laura', 'Mei', 'Nadia', 'Olivia', 'Priya', 'Rosa', 'Sarah', 'Tamara', 'Uma', 'Valeria', 'Wendy', 'Ximena', 'Yasmin', 'Zoe', 'Aisha', 'Brenda', 'Carmen', 'Diane', 'Esther', 'Linh', 'Monique', 'Rachel', 'Sofia', 'Teresa']
const FIRST_M = ['Aaron', 'Bilal', 'Carlos', 'Daniel', 'Emeka', 'Farid', 'George', 'Hiro', 'Ivan', 'James', 'Kwame', 'Luis', 'Marcus', 'Nikhil', 'Omar', 'Paul', 'Raj', 'Samuel', 'Thomas', 'Victor', 'Wei', 'Yusuf', 'Andre', 'Brian', 'Diego', 'Ethan', 'Kenji', 'Mateo', 'Noah', 'Owen']
const LAST = ['Abernathy', 'Bautista', 'Castellano', 'Dimitriou', 'Eklund', 'Fairbanks', 'Gallagher', 'Haddad', 'Ibarra', 'Jablonski', 'Kaminski', 'Lindqvist', 'Moreau', 'Nakamura', 'Oyelaran', 'Pereira', 'Quintero', 'Rasmussen', 'Salazar', 'Tanaka', 'Underwood', 'Varga', 'Whitfield', 'Xu', 'Yamamoto', 'Zielinski', 'Achebe', 'Brennan', 'Chaudhry', 'Delgado', 'Estrada', 'Fitzgerald', 'Gutierrez', 'Holloway', 'Iyer', 'Jovanovic', 'Kowalczyk', 'Lombardi', 'Mbeki', 'Novak', 'Okonkwo', 'Petrov', 'Rahman', 'Sandoval', 'Thornton', 'Vasquez', 'Weinberg', 'Adeyemi', 'Bergstrom', 'Coleman']

const PROVIDERS: Record<Area, string[]> = {
  Cancer: ['Dr. Helen Marsh (Breast Surgery)', 'Dr. Arjun Patel (Medical Oncology)', 'Dr. Colette Dubois (Gyn Oncology)', 'Dr. Samuel Reyes (GI / Colorectal)', 'Dr. Naomi Feld (Primary Care)'],
  Cardio: ['Dr. Victor Lindahl (Cardiology)', 'Dr. Amara Nwosu (Electrophysiology)', 'Dr. Grace Holm (Pediatric Cardiology)'],
  Neuro: ['Dr. Tomas Varga (Pediatric Neurology)', 'Dr. Leila Haddad (Epilepsy Center)', 'Dr. Ben Okafor (Neurology)'],
}

const LABS = ['Labcorp/Invitae', 'Ambry Genetics', 'GeneDx', 'Myriad Genetics', 'Quest Diagnostics'] as const
const LABS_BY_AREA: Record<Area, readonly string[]> = {
  Cancer: LABS,
  Cardio: ['Labcorp/Invitae', 'GeneDx', 'Ambry Genetics', 'Quest Diagnostics'],
  Neuro: ['GeneDx', 'Labcorp/Invitae', 'Ambry Genetics'],
}

const TESTS: Record<Area, string[]> = {
  Cancer: ['Multi-gene hereditary cancer panel (84 genes)', 'Hereditary breast and ovarian cancer panel (13 genes)', 'Lynch syndrome panel (5 genes)', 'Multi-gene hereditary cancer panel (47 genes)', 'Hereditary pancreatic cancer panel (18 genes)'],
  Cardio: ['Comprehensive cardiomyopathy panel (102 genes)', 'Hypertrophic cardiomyopathy panel (26 genes)', 'Arrhythmia and long QT panel (35 genes)'],
  Neuro: ['Comprehensive epilepsy panel (296 genes)', 'Early-onset epilepsy panel (144 genes)', 'Exome sequencing (trio)'],
}

function indication(area: Area, sex: 'F' | 'M', age: number, gene?: string): string {
  const dx = () => Math.max(25, Math.min(age - 1, int(30, 70)))
  if (area === 'Cancer') {
    if (gene && ['MLH1', 'MSH2', 'MSH6', 'PMS2'].includes(gene))
      return pick([`Personal history of colorectal cancer, dx age ${dx()}`, 'Tumor MSI-high / MMR-deficient on IHC', 'Family history of colorectal and endometrial cancer'])
    const f = [`Personal history of breast cancer, dx age ${dx()}`, `Personal history of ovarian cancer, dx age ${dx()}`, `Personal history of triple-negative breast cancer, dx age ${dx()}`, 'Family history: mother with breast cancer <50', 'Family history: sister with ovarian cancer', `Personal history of endometrial cancer, dx age ${dx()}`, `Personal history of pancreatic cancer, dx age ${dx()}`, 'Known familial BRCA2 variant in first-degree relative']
    const m = [`Personal history of prostate cancer (Gleason 8), dx age ${dx()}`, `Personal history of male breast cancer, dx age ${dx()}`, `Personal history of pancreatic cancer, dx age ${dx()}`, `Personal history of colorectal cancer, dx age ${dx()}`, 'Family history: multiple relatives with breast/ovarian cancer']
    return pick(sex === 'F' ? f : m)
  }
  if (area === 'Cardio')
    return pick(['Hypertrophic cardiomyopathy on echo (IVS 19 mm)', 'Dilated cardiomyopathy, LVEF 30%', 'Prolonged QTc (510 ms) with syncope', 'Brugada pattern on ECG', 'Family history of sudden cardiac death <40', 'First-degree relative with HCM'])
  return pick(['Infantile-onset epilepsy, drug-resistant', 'Febrile seizures progressing to Dravet-like phenotype', 'Epileptic encephalopathy with developmental delay', 'Speech regression with CSWS on EEG', 'Global developmental delay and seizures', 'Focal epilepsy with language disorder'])
}

const TODAY = new Date('2026-09-25T12:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)
function dateBetween(fromYear: number, toIso: string): string {
  const a = new Date(`${fromYear}-01-01`).getTime()
  const b = new Date(toIso).getTime()
  return iso(new Date(a + rand() * (b - a)))
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main() {
  let variants: ClinVarRecord[]
  let source: 'eutils' | 'fallback' = 'eutils'
  try {
    console.log('Fetching ClinVar records via NCBI E-utilities…')
    variants = await fetchVariants()
    if (!variants.some((v) => v.variation_id === REQUIRED_ID)) throw new Error(`required variant ${REQUIRED_ID} missing`)
    writeFileSync(CACHE, JSON.stringify(variants, null, 2) + '\n')
  } catch (err) {
    console.error(`\n!!! E-utilities failed (${(err as Error).message}). USING FALLBACK VARIANT LIST.\n`)
    source = 'fallback'
    variants = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : []
    if (!variants.some((v) => v.variation_id === REQUIRED_ID))
      variants.push({
        variation_id: REQUIRED_ID,
        accession: 'VCV003672027',
        title: 'NM_001134407.3(GRIN2A):c.1152C>A (p.Ser384Arg)',
        gene: 'GRIN2A',
        classification: 'Conflicting classifications of pathogenicity',
        review_status: 'criteria provided, conflicting classifications',
        last_evaluated: '2026-04-15',
      })
  }

  // Variant pools by area and current ClinVar category
  const pool = (area: Area, cats: ClassCategory[]) =>
    shuffle(variants.filter((v) => areaOf(v.gene) === area && cats.includes(normalize(v.classification))))
  const pools = {} as Record<Area, { vus: ClinVarRecord[]; changed: ClinVarRecord[]; plp: ClinVarRecord[] }>
  for (const area of Object.keys(GENES) as Area[]) {
    pools[area] = {
      vus: pool(area, ['Uncertain significance']),
      // Variants reported as VUS at the time that ClinVar now classifies differently
      // (a lab would never call a truncating variant a VUS, so VUS → P/LP upgrades are missense only)
      changed: pool(area, ['Conflicting', 'Likely pathogenic', 'Pathogenic', 'Likely benign', 'Benign']).filter(
        (v) =>
          v.variation_id !== REQUIRED_ID &&
          (normalize(v.classification) === 'Conflicting' || isMissense(v.title)),
      ),
      plp: pool(area, ['Pathogenic', 'Likely pathogenic']),
    }
  }
  const required = variants.find((v) => v.variation_id === REQUIRED_ID)!
  const used = new Set<string>()
  const take = (xs: ClinVarRecord[], fallback: ClinVarRecord[]): ClinVarRecord => {
    const v = xs.find((x) => !used.has(x.variation_id)) ?? fallback.find((x) => !used.has(x.variation_id)) ?? pick(xs.length ? xs : fallback)
    used.add(v.variation_id)
    return v
  }

  // Result plan: 120 patients → 70 negative, 36 VUS (5 with two VUS), 14 LP/P
  type Plan = { result: 'Negative' | 'VUS' | 'Likely pathogenic' | 'Pathogenic'; area: Area; vusCount: number; changed: number }
  const areaDraw = (): Area => { const r = rand(); return r < 0.65 ? 'Cancer' : r < 0.85 ? 'Cardio' : 'Neuro' }
  const plans: Plan[] = []
  for (let i = 0; i < 70; i++) plans.push({ result: 'Negative', area: areaDraw(), vusCount: 0, changed: 0 })
  // The required GRIN2A conflicting variant lives on a dedicated neuro VUS case (vusCount -1)
  plans.push({ result: 'VUS', area: 'Neuro', vusCount: -1, changed: 0 })
  for (let i = 1; i < 36; i++) plans.push({ result: 'VUS', area: areaDraw(), vusCount: i <= 5 ? 2 : 1, changed: i > 5 && i <= 16 ? 1 : 0 })
  for (let i = 0; i < 14; i++) plans.push({ result: i < 8 ? 'Pathogenic' : 'Likely pathogenic', area: areaDraw(), vusCount: 0, changed: 0 })

  const nowIso = new Date().toISOString()
  const usedNames = new Set<string>()
  const usedMrns = new Set<string>()
  const patients = shuffle(plans).map((plan, idx) => {
    const { area } = plan
    const sex: 'F' | 'M' = area === 'Cancer' ? (rand() < 0.78 ? 'F' : 'M') : rand() < 0.5 ? 'F' : 'M'
    const age = area === 'Neuro' ? int(1, 17) : area === 'Cardio' ? int(14, 72) : int(26, 79)
    const dob = new Date(TODAY)
    dob.setUTCFullYear(TODAY.getUTCFullYear() - age)
    dob.setUTCDate(dob.getUTCDate() - int(1, 360))
    let name: string
    do name = `${pick(sex === 'F' ? FIRST_F : FIRST_M)} ${pick(LAST)}`
    while (usedNames.has(name))
    usedNames.add(name)
    let mrn: string
    do mrn = `CH${int(1000000, 9999999)}`
    while (usedMrns.has(mrn))
    usedMrns.add(mrn)

    const lab = pick(LABS_BY_AREA[area])
    // Changed cases were reported earlier, so ClinVar has had time to move
    const reportDate = plan.changed || plan.vusCount === -1 ? dateBetween(2019, '2023-06-30') : dateBetween(2019, '2026-08-31')

    const chosen: { rec: ClinVarRecord; reported: string }[] = []
    if (plan.vusCount === -1) chosen.push({ rec: required, reported: 'Uncertain significance' })
    for (let k = 0; k < plan.vusCount; k++) {
      const changed = k < plan.changed
      const rec = changed ? take(pools[area].changed, pools[area].vus) : take(pools[area].vus, pools[area].changed)
      chosen.push({ rec, reported: 'Uncertain significance' })
    }
    if (plan.result === 'Pathogenic' || plan.result === 'Likely pathogenic') {
      const rec = take(pools[area].plp, pools.Cancer.plp)
      chosen.push({ rec, reported: plan.result })
    }
    const gene = chosen[0]?.rec.gene

    const variantsOut = chosen.map(({ rec, reported }) => {
      const changed = tier(rec.classification) !== tier(reported)
      return {
        gene: rec.gene,
        hgvs: rec.title,
        zygosity: 'Heterozygous',
        reported_classification: { classification: reported, lab, date: reportDate },
        clinvar: {
          variation_id: rec.variation_id,
          vcv: rec.accession,
          url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${rec.variation_id}/`,
          classification: rec.classification,
          review_status: rec.review_status,
          last_evaluated: rec.last_evaluated,
        },
        classification_changed: changed,
        watch_status: changed ? 'active' : 'quiet',
      }
    })
    const result: Plan['result'] =
      variantsOut.some((v) => v.reported_classification.classification === 'Pathogenic') ? 'Pathogenic'
      : variantsOut.some((v) => v.reported_classification.classification === 'Likely pathogenic') ? 'Likely pathogenic'
      : variantsOut.length ? 'VUS' : 'Negative'

    const activeVariant = variantsOut.find((v) => v.classification_changed)
    const next_action = activeVariant
      ? `Review ${activeVariant.gene}: VUS → ${tier(activeVariant.clinvar.classification)} in ClinVar`
      : result === 'VUS' ? 'Routine ClinVar recheck'
      : result === 'Negative' ? '—'
      : 'Cascade testing offered'

    return {
      id: `P${String(idx + 1).padStart(3, '0')}`,
      mrn,
      name,
      dob: iso(dob),
      age,
      sex,
      clinic_area: area,
      indication: indication(area, sex, age, gene),
      ordering_provider: pick(PROVIDERS[area]),
      testing_lab: lab,
      test_name: pick(TESTS[area]),
      report_date: reportDate,
      result_category: result,
      variants: variantsOut,
      last_checked: nowIso,
      next_action,
      gc_decisions: [],
      history: [],
    }
  })

  const out = {
    fictional: true,
    disclaimer: 'FICTIONAL DEMO DATA. All patients, names, MRNs, providers and lab-reported classifications are invented. Variants and current classifications are real public ClinVar records.',
    generated_at: nowIso,
    variant_source: source,
    clinic: { name: 'Cedar Hollow Medical Center', department: 'Genetic Counseling' },
    gc: { name: 'Maya Lindqvist, MS, CGC' },
    patients,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')

  const allVariants = patients.flatMap((p) => p.variants)
  const counts = {
    patients: patients.length,
    negative: patients.filter((p) => p.result_category === 'Negative').length,
    withVus: patients.filter((p) => p.variants.some((v) => v.reported_classification.classification === 'Uncertain significance')).length,
    twoVus: patients.filter((p) => p.variants.filter((v) => v.reported_classification.classification === 'Uncertain significance').length >= 2).length,
    plp: patients.filter((p) => p.result_category === 'Pathogenic' || p.result_category === 'Likely pathogenic').length,
    variantsOnReports: allVariants.length,
    uniqueVariants: new Set(allVariants.map((v) => v.clinvar.variation_id)).size,
    clinvarRecordsFetched: variants.length,
    activeCases: patients.filter((p) => p.variants.some((v) => v.watch_status === 'active')).length,
    has3672027: allVariants.some((v) => v.clinvar.variation_id === REQUIRED_ID),
  }
  console.log(`\nWrote ${OUT} (variant source: ${source})`)
  console.table(counts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
