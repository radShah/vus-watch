# VUS Watch

VUS Watch is an agent that rechecks a genetic counselor's caseload of variants of uncertain significance (VUS) against live ClinVar pages, sorts out which lab changed its call, and queues the cases that need the counselor: urgent upgrades to review and patient letters to approve.

> **All patient data is fictional.** Patients, names, MRNs, providers and lab-reported classifications are invented. The variants themselves are real public ClinVar records, and their current classifications and review statuses come from ClinVar via NCBI E-utilities.

## The problem

A lab that reports a VUS may reclassify it years later, and ClinVar is where those changes show up first. A genetic counselor with a caseload of VUS results has no practical way to recheck every variant by hand, so a patient can miss a reclassification that changes their care. TODO: a sourced number on how often VUS results are reclassified, if you want one.

## Demo

- Video (3 min): TODO: demo video link
- Screenshot: TODO: screenshot

## What the agent does on its own

Each cycle, with no manual step, the agent:

1. fetches the live ClinVar page for every watched variant over the web (Nimble),
2. extracts each lab's current call from the page (Liquid AI),
3. compares it with what the last cycle stored,
4. decides what the case needs: `flag_upgrade`, `flag_downgrade`, `hold`, `recheck` or `quiet`,
5. logs what happened and updates the counselor's worklist.

`npm run cycle` runs a whole cycle unattended. Nothing in the repo schedules it yet; each cycle starts with that command.

Contacting a patient waits for the counselor's approval **by design**. This is clinical work, and a person signs off before a patient hears anything. That is the only human step.

## Plan, act, observe, self-correct, without drowning in history

Here, "preserve what matters" means the agent keeps each patient's current classification, the counselor's decisions and the counselor's trust in each lab, and lets unchanged rechecks go quiet instead of piling up.

- **Plan**: each cycle picks the variants in scope: reported as a VUS, conflicting on ClinVar, or still being watched (`scripts/run-cycle.ts`, `inScope`). `--variant <id>` narrows a cycle to one ClinVar Variation ID.
- **Act**: fetches the rendered ClinVar page (`src/agent/nimbleClinvar.ts`) and extracts each lab's submission (`src/agent/liquidExtract.ts`).
- **Observe**: compares classification, record version and each lab's call with the stored record, and appends every fetch, change and decision to `data/events.jsonl` (`scripts/run-cycle.ts`, `src/agent/events.ts`).
- **Self-correct**:
  - a failed fetch is retried once (`scripts/run-cycle.ts`, `fetchWithRetry`);
  - if Nimble's parser returns nothing, the same CSS selectors run locally on the HTML Nimble returned (`src/agent/nimbleClinvar.ts`);
  - Liquid's answer is checked in code against the source text (every lab, SCV accession and date must appear in its row). An invalid answer is sent back with the list of errors for one retry; rate limits and server errors back off and retry (`src/agent/liquidExtract.ts`);
  - a record it couldn't read gets `recheck` next cycle, never a guess (`src/agent/decide.ts`).
- **History**: `data/caseload.json` holds only where each case stands now. The decision step reads that and the counselor's settings, never the event log. Full history goes to `data/events.jsonl` and RawTree; the dashboard asks RawTree for per-cycle counts with SQL instead of reading the rows. Unchanged cases get `quiet` and log no new decision. Liquid results are cached per ClinVar record version, so an unchanged record is never re-sent to the model.
- **Memory**: the counselor's approve / hold / dismiss decisions (stored per case in `data/caseload.json`) and lab-trust settings (`data/gc_preferences.json`) change later cycles' decisions. A case held "until an established lab weighs in" is released when a lab the counselor rates established calls it benign; a dismissed case stays quiet until a new lab call appears (`src/agent/decide.ts`).

Checks: Liquid's validation against the source text, `npm run build` (type check and build) and `npm run lint`. The repo has no automated tests.

## Sponsor tools

| Tool | What it does in VUS Watch | Code |
|---|---|---|
| Nimble | Fetches the live ClinVar variation page (rendered) and parses it with CSS selectors; falls back to parsing the returned HTML locally. | `src/agent/nimbleClinvar.ts` |
| Liquid AI LFM2.5 | Extracts each lab's submission (lab, classification, dates, SCV, evidence tags), checked in code against the source text. Runs on OpenRouter (default) or local Ollama. | `src/agent/liquidExtract.ts` |
| Tinybird / RawTree | Stores one row per case per cycle; feeds the dashboard's "Caseload activity" strip. | `src/agent/rawtree.ts` |
| Black Forest Labs FLUX.2 [pro] | Restyles a code-drawn DNA-helix image into the header for benign-reclassification patient letters. | `src/agent/fluxLetterImage.ts` |

## Quickstart, no API keys

Requires Node **20.19+ or 22.12+** (Vite 8 needs it).

```sh
npm install
npm run dev    # open http://localhost:5173
```

Without keys you get the dashboard, approving / holding / dismissing cases, and lab-trust settings, all on the committed data. The "Caseload activity" strip shows "RawTree unavailable" without `RAWTREE_API_KEY`.

## Run the agent

```sh
cp .env.example .env   # npm run cycle crashes without a .env file
```

| Command | Needs | Without it |
|---|---|---|
| `npm run cycle` (about 6 min)<br>`npm run cycle -- --variant 3672027` (seconds) | `NIMBLE_API_KEY` | Every fetch is counted as failed, cases get `recheck`, and the cycle still finishes. |
| | `OPENROUTER_API_KEY` + `LIQUID_MODEL` | The cycle exits at the first extraction and the run is lost. Or set `LIQUID_PROVIDER=ollama` (no key; needs `ollama serve`). |
| | `RAWTREE_API_KEY` | Warning only; the cycle is saved. |
| `npm run rawtree:sync` | `RAWTREE_API_KEY` | Exits with an error. |
| `npx tsx src/agent/fluxLetterImage.ts` | `BFL_API_KEY`, Google Chrome | Exits with an error. Set `CHROME_PATH` in the shell, not in `.env`, if Chrome isn't at the macOS default path. The demo image `public/letters/P121-1686523.png` is already committed. |
| `npm run seed` | nothing | — |

**Warning:** `npm run seed` rebuilds `data/caseload.json` from scratch. It removes the P121 letter demo case and the cycle history, and leaves `data/events.jsonl` out of sync. It's optional; the committed data is ready to use.

## How it works

1. **Fetch**: Nimble renders the ClinVar page; `src/agent/nimbleClinvar.ts` parses it.
2. **Extract**: Liquid turns the submissions table into one JSON object per lab, validated against the page text.
3. **Compare and decide**: `scripts/run-cycle.ts` diffs against `data/caseload.json`; `src/agent/decide.ts` applies the counselor's rules (which lab changed, how much the counselor trusts it for the case's specialty).
4. **Log**: events go to `data/events.jsonl`, rows to RawTree.
5. **Review**: the counselor works the dashboard; the dev API in `src/server/api.ts` saves their decisions and lab-trust changes.

## Project layout

- `src/agent/`: the cycle's steps: fetch, extract, decide, event log, RawTree, letter images
- `src/components/`: React dashboard (worklist, patient drawer, letter preview, lab-trust panel, activity strip)
- `src/lib/`: shared logic for the dashboard and agent (clinical labels, filters, lab trust, letters)
- `src/server/`: dev-server API for the counselor's decisions, lab trust and RawTree counts
- `scripts/`: `run-cycle.ts` (one agent cycle), `seed-caseload.ts` (builds the fictional caseload)
- `data/caseload.json`: where each case stands now (`"fictional": true`)
- `data/events.jsonl`: append-only log of every fetch, change, decision and counselor action
- `data/gc_preferences.json`: the counselor's lab-trust tiers and their change history

## RawTree: caseload history

After each cycle, `src/agent/rawtree.ts` sends one row per case (patient × variant) to the RawTree table `vus_watch_case_cycles`: cycle, decision, watch status, classification before and after, the lab that changed, fetch path, and three flags computed in TypeScript. `GET /api/caseload-activity` runs SQL against RawTree on the server (the key never reaches the browser), and the "Caseload activity" strip shows, for each cycle and the one before:

- **Watched**: patients whose variants the cycle rechecked.
- **Woke up**: patients with a variant whose decision isn't `quiet`.
- **Urgent upgrades**: patients with a `flag_upgrade`.
- **Awaiting GC review**: patients on "Waiting on me" or "Letters to approve".

The SQL only counts distinct patients per flag, so the strip matches the worklist. A `--variant` cycle appears on its own line. RawTree keeps every row, so the sender sends only cycles the table doesn't have yet, with a dedup token. Cycles from before this integration were backfilled from `data/events.jsonl`; their watch status wasn't recorded, so "Awaiting GC review" shows "—" for them.

Not built yet: the agent querying its own history before deciding (for example, escalating a case that has waited on the counselor for several cycles).

## Team

TODO: team names and contact emails

---

Built at the Long Horizon Agents Hackathon, Sep 25, 2026.
