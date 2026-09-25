# VUS Watch

VUS Watch is an agent that rechecks a genetic counselor's caseload of variants of uncertain significance (VUS) against live ClinVar pages, sorts out which lab changed its call, and queues the cases that need the counselor: urgent upgrades to review and patient letters to approve.

> **All patient data is fictional.** Patients, names, MRNs, providers and lab-reported classifications are invented. The variants themselves are real public ClinVar records, and their current classifications and review statuses come from ClinVar via NCBI E-utilities.

## The problem

A lab that reports a VUS may reclassify it years later, and ClinVar is where those changes show up first. A genetic counselor with a caseload of VUS results has no practical way to recheck every variant by hand, so a patient can miss a reclassification that changes their care. TODO: a sourced number on how often VUS results are reclassified, if you want one.

## Demo

- Video (3 min): TODO: demo video link
- Screenshot: TODO: screenshot

## How it works

1. **Pick** the variants to recheck: reported as a VUS, conflicting on ClinVar, or still being watched (`scripts/run-cycle.ts`).
2. **Fetch** each live ClinVar page with Nimble. A failed fetch is retried once; if Nimble's parser returns nothing, the returned HTML is parsed locally (`src/agent/nimbleClinvar.ts`).
3. **Extract** each lab's call with Liquid. The answer is checked against the page text, and a wrong answer gets one retry with the errors listed. Results are cached per ClinVar record version (`src/agent/liquidExtract.ts`).
4. **Decide**: compare with the last cycle, then flag an urgent upgrade, flag a likely downgrade for a patient letter, hold, recheck next cycle, or stay quiet. The decision uses the counselor's past decisions and how much they trust each lab (`src/agent/decide.ts`).
5. **Log** to `data/events.jsonl` and RawTree. The counselor reviews in the dashboard.

`npm run cycle` runs a whole cycle unattended; nothing schedules it yet. Contacting a patient waits for the counselor's approval by design. That is the only human step.

`data/caseload.json` holds only where each case stands now. The decision step never reads the event log, and unchanged cases stay quiet.

## Sponsor tools

| Tool | What it does | Where you see it | Code |
|---|---|---|---|
| Nimble | Fetches the live ClinVar page | Patient drawer: ClinVar classification, review status, "Last checked" | `src/agent/nimbleClinvar.ts` |
| Liquid AI LFM2.5 | Extracts each lab's submission, checked against the page text. Runs on OpenRouter or local Ollama. | Patient drawer: "Lab submissions" table | `src/agent/liquidExtract.ts` |
| Tinybird / RawTree | Stores one row per case per cycle, queried with SQL | "Caseload activity" strip at the top of the dashboard; its counts match the worklist | `src/agent/rawtree.ts` |
| Black Forest Labs FLUX.2 [pro] | Makes the header image for letters about a VUS now called benign | Letter preview in the patient drawer | `src/agent/fluxLetterImage.ts` |

## Run it

Needs Node 20.19+ or 22.12+.

```sh
npm install
npm run dev    # open http://localhost:5173
```

This works with no keys: the dashboard, approving, holding or dismissing cases, and lab-trust settings, on the committed data. The activity strip shows "RawTree unavailable" without a RawTree key.

To run the agent, `cp .env.example .env` first (`npm run cycle` crashes without a `.env` file), then add keys:

| Key | Get it from | Used by | Without it |
|---|---|---|---|
| `NIMBLE_API_KEY` | TODO: key URL | `npm run cycle` | Every fetch fails; the cycle still finishes and rechecks next time. |
| `OPENROUTER_API_KEY` + `LIQUID_MODEL` | https://openrouter.ai/keys | `npm run cycle` | The cycle exits and the run is lost. Or set `LIQUID_PROVIDER=ollama` (no key; needs `ollama serve`). |
| `RAWTREE_API_KEY` | rawtree.com (request access) | `npm run cycle`, `npm run rawtree:sync` | Warning only; the cycle is saved. |
| `BFL_API_KEY` | TODO: key URL | `npx tsx src/agent/fluxLetterImage.ts` | Exits with an error. |

- `npm run cycle`: one cycle over the watched caseload (about 6 min).
- `npm run cycle -- --variant 3672027`: one ClinVar Variation ID (seconds).
- `npm run rawtree:sync`: sends any cycles RawTree doesn't have yet.
- `npx tsx src/agent/fluxLetterImage.ts`: needs Google Chrome; set `CHROME_PATH` in the shell if it isn't at the macOS default path. The demo image is already committed.

Don't run `npm run seed` unless you mean to: it rebuilds `data/caseload.json` from scratch, drops the letter demo case and cycle history, and leaves `data/events.jsonl` out of sync.

## Project layout

- `src/agent/`: fetch, extract, decide, event log, RawTree, letter images
- `src/components/`, `src/lib/`: React dashboard and shared logic
- `src/server/api.ts`: dev-server API for the counselor's decisions, lab trust and RawTree counts
- `scripts/`: `run-cycle.ts` (one cycle), `seed-caseload.ts` (builds the fictional caseload)
- `data/`: `caseload.json` (current state), `events.jsonl` (every fetch, change and decision), `gc_preferences.json` (lab trust)

## Team

- Radha Shah — radha.shah@gmail.com
- Sofia Garcia, MS, GC (advisor)

---

Built at the Long Horizon Agents Hackathon, Sep 25, 2026.
