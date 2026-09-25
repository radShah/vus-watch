# VUS Watch

VUS Watch is an agent that watches a genetic counselor's caseload of patients with variants of uncertain significance (VUS). It rechecks each variant against ClinVar, flags reclassifications, and queues the follow-up work (lab re-queries, amended reports, patient recontact letters) for the genetic counselor to review and approve.

Status: the fictional caseload and the clinician dashboard are built. The agent steps (live ClinVar checks, fact extraction, event log) are in progress.

> **All patient data is fictional.** Patients, names, MRNs, providers and lab-reported classifications are invented. The variants themselves are real public ClinVar records, and their current classifications and review statuses come from ClinVar via NCBI E-utilities.

## Run it locally

Requires Node 20+.

```sh
npm install
npm run seed   # fetch ClinVar records and write data/caseload.json (about 1 minute)
npm run dev    # open http://localhost:5173
```

`data/caseload.json` is committed, so `npm run seed` is optional. If E-utilities is unreachable, the seed script falls back to the ClinVar records cached in `scripts/fallback-variants.json` and marks the dataset `"variant_source": "fallback"`.

## Project layout

- `scripts/seed-caseload.ts`: builds the fictional caseload from real ClinVar variants
- `data/caseload.json`: the generated caseload (`"fictional": true`)
- `src/`: Vite + React + TypeScript + Tailwind dashboard (clinician worklist, filters, patient detail drawer)

## Sponsor tools

- **Nimble**: _coming soon_ (live ClinVar fetches)
- **Liquid AI**: _coming soon_ (fact extraction with small models)
- **Tinybird / RawTree**: _coming soon_ (event log and agent memory)
- **Black Forest Labs**: _coming soon_

---

Built at the Long Horizon Agents Hackathon, Sep 25, 2026.
