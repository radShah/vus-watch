# Update README.md for hackathon judges

Deadline: submissions close **4:30 PM PT, Sep 25, 2026** (Long Horizon Agents Hackathon).
Work fast. Change **only README.md**. Show me the full diff and wait for "go" before
committing or pushing. Never commit this prompt file (`prompts/`), `data/`, or
`public/letters/candidates/`.

## Before you start
1. Run `git status`. Another session may be mid-way through adding RawTree
   (`src/agent/rawtree.ts`, `src/components/CaseloadActivity.tsx`, `rawtree:sync` in
   package.json). The current README already has uncommitted RawTree edits. Keep them; build
   on the README as it is now, not on HEAD.
2. If `src/agent/rawtree.ts` is still untracked when you're ready to push, stop and tell me.
   A README that documents `npm run rawtree:sync` must not ship before that code does.

## Hackathon rules the README must support
Sources: tokens& emails "Hackathon starts in 30 mins!" and "doors open at 9:30 AM";
hack page https://tokensand.com/horizonagentshack; event slides photographed at kickoff (theme, judging criteria).
- Public GitHub repo. Done: github.com/radShah/vus-watch.
- "A short demo video with a shareable link" (a 3-minute demo). Put a `TODO: demo video link`
  near the top.
- "What you built and the tools you used."
- "Your team's names and contact emails." Add a `TODO: team names and emails` section.
- "Use at least 3 sponsor tools." "No previous projects." All commits are from Sep 25.
- Optional: a screenshot. Add `TODO: screenshot` under the pitch.
- Sponsor prizes: Nimble ("Best use of Nimble"), Tinybird ("Best use of Tinybird"), Liquid AI,
  and Black Forest Labs (FLUX Image track).
- Theme, from the kickoff slide: "Build agents that preserve what matters. Ship long horizon
  agents that plan, act, observe, and self-correct across a full build cycle (spec,
  implementation, testing, iteration) without drowning in their own history. Use 3+ sponsor
  tools."
- Judging criteria, from the event slide (no weights given):
  - **Autonomy**: "How well does the agent act on the web using real-time data without manual
    intervention?"
  - **Idea**: "Does the solution have the potential to solve a meaningful problem or demonstrate
    real-world value?"
  - **Technical Implementation**: "How well is the architecture built and how well was the
    solution implemented?"
  - **Tool Use**: "Did the solution effectively use at least 3 sponsor tools?"
  - **Presentation (Demo)**: "Demonstration of the solution in 3 minutes."
  Build the README so a judge can score each criterion from it, but don't add headings named
  after the criteria.

Never invent a URL, a name or a number. Use `TODO:` for anything I haven't given you.

## Target structure (a judge should get it in 2 minutes)
1. **Title + one-line pitch**, then the existing "All patient data is fictional" note, unchanged.
2. **The problem** (Idea; 2 to 3 sentences): ClinVar reclassifies VUS results over time, and
   genetic counselors have no practical way to recheck a whole caseload by hand, so patients
   can miss news that changes their care. Don't make up statistics; use `TODO:` if you want a
   number.
3. **Demo**: `TODO: demo video link (3 min)`, `TODO: screenshot`.
4. **What the agent does on its own** (Autonomy): each cycle it fetches live ClinVar pages over
   the web (Nimble), extracts each lab's call (Liquid), compares them with the last cycle, and
   decides, with no manual step. It runs unattended with `npm run cycle`. Say plainly that
   contacting a patient waits for the counselor's approval **by design**, because this is
   clinical work. That is the only human step.
5. **Plan, act, observe, self-correct, without drowning in history** (theme; one bullet each,
   each tied to a file):
   - plan: picks which variants are in scope this cycle (`scripts/run-cycle.ts`)
   - act: fetches and extracts (`src/agent/nimbleClinvar.ts`, `src/agent/liquidExtract.ts`)
   - observe: compares with the stored record and logs events (`src/agent/events.ts`)
   - self-correct: retries failed fetches, retries Liquid answers that fail validation against
     the source text, and falls back to local parsing (`src/agent/nimbleClinvar.ts`)
   - history: `data/caseload.json` holds only current state; full history goes to
     `data/events.jsonl` and RawTree, which are queried, never re-read in full. Unchanged
     records stay quiet. Liquid results are cached per ClinVar record version.
   - memory: the counselor's decisions and lab-trust settings (`data/gc_preferences.json`)
     change later cycles' decisions (`src/agent/decide.ts`).
   Check each bullet against the code before writing it; drop any that doesn't hold.
   Open this section with one sentence on what "preserve what matters" means here: the agent
   keeps each patient's current classification, the counselor's decisions and lab trust, and
   lets unchanged rechecks go quiet instead of piling up.
   The slide's "full build cycle (spec, implementation, testing, iteration)" is about agents
   that build software. VUS Watch runs watch cycles, not build cycles. Don't claim it builds
   software, and don't claim automated tests: the repo has none. Its checks are Liquid's
   validation against the source text, `npm run build` (type check) and `npm run lint`.
6. **Sponsor tools table** (Tool Use): columns Tool | What it does in VUS Watch | Code.
   - Nimble (`src/agent/nimbleClinvar.ts`): fetches the live ClinVar variation page (rendered,
     parsed with CSS selectors; falls back to parsing the returned HTML locally).
   - Liquid AI LFM2.5 (`src/agent/liquidExtract.ts`): extracts each lab's submission, checked in
     code against the source text. Runs on OpenRouter (default) or local Ollama.
   - Tinybird / RawTree (`src/agent/rawtree.ts`): one row per case per cycle; feeds the dashboard's
     "Caseload activity" strip.
   - Black Forest Labs FLUX.2 [pro] (`src/agent/fluxLetterImage.ts`): restyles a code-drawn
     DNA-helix image into the header for benign-reclassification patient letters.
   Delete every "_coming soon_".
7. **Quickstart, no API keys** (Node **20.19+ or 22.12+**; Vite 8 needs it):
   `npm install` then `npm run dev` and open http://localhost:5173. Say what works without keys:
   the dashboard, approving/holding cases, and lab-trust settings. The activity strip shows
   "RawTree unavailable" without `RAWTREE_API_KEY`.
8. **Run the agent**: `cp .env.example .env` first; `npm run cycle` crashes without a `.env`
   file. Then a table: Command | Needs | Without it.
   - `npm run cycle` (about 6 min) and `npm run cycle -- --variant 3672027` (seconds):
     - `NIMBLE_API_KEY`: fetches are counted as failed and the cycle still finishes.
     - `OPENROUTER_API_KEY` + `LIQUID_MODEL`: cycle exits and the run is lost. Or set
       `LIQUID_PROVIDER=ollama` (no key; needs `ollama serve`).
     - `RAWTREE_API_KEY`: warning only.
   - `npm run rawtree:sync`: `RAWTREE_API_KEY`.
   - `npx tsx src/agent/fluxLetterImage.ts`: `BFL_API_KEY` plus Google Chrome. Set
     `CHROME_PATH` in the shell, not in `.env`, if Chrome isn't at the macOS default path. The
     demo image `public/letters/P121-1686523.png` is already committed.
   - `npm run seed`: no keys. **Warn:** it rebuilds `data/caseload.json` from scratch, removes
     the P121 letter demo case and cycle history, and leaves `events.jsonl` out of sync. It's
     optional; the committed data is ready to use.
9. **How it works** (Technical Implementation) (5 lines at most): fetch (Nimble), extract (Liquid), compare, decide
   (`src/agent/decide.ts`), log (`events.jsonl` + RawTree), then the counselor reviews in the
   dashboard. The dev API lives in `src/server/api.ts`.
10. **Project layout**: one line each for `src/agent/`, `src/components/`, `src/lib/`,
   `src/server/`, `scripts/`, and the three `data/` files.
11. Keep the existing "RawTree: caseload history" section, shortened if it's long. Keep the
   "Built at the Long Horizon Agents Hackathon, Sep 25, 2026" footer.
12. **Team**: `TODO: team names and contact emails`.

Remove the old "Status:" line.

## Grade the README against the kickoff slide before showing it to me
The kickoff slide is the grading standard. After drafting, score the README against each line
below. For each one, answer: which README sentence shows it, which file proves it, and pass
or gap. Fix gaps where the code supports it. If the code doesn't support a line, list it as
a gap; don't write around it.

| Slide requirement | README must show |
|---|---|
| "preserve what matters" | what the agent keeps across cycles, and what it lets go quiet |
| "plan" | how a cycle picks which variants to recheck |
| "act" | live web fetch and extraction, with no manual step |
| "observe" | comparing with the last cycle, and the event log |
| "self-correct" | retries, validation against source text, fallback parsing |
| "full build cycle (spec, implementation, testing, iteration)" | honest mapping, or a gap: no automated tests; checks are validation, build, lint |
| "without drowning in their own history" | current state vs history, quiet on unchanged, cache, RawTree queried not re-read |
| "Use 3+ sponsor tools" | table of 4 tools, each with its code file |

Then score it the same way against the five judging criteria above (Autonomy, Idea,
Technical Implementation, Tool Use, Presentation).

## Check every claim
Every command, path and env var you mention must exist: check it with `ls`, `grep` or
`package.json`. If the code disagrees with this prompt, trust the code and tell me.
Run `npm run build` once at the end to make sure nothing is broken.

## Voice
Plain, short sentences. No marketing words ("revolutionary", "seamless", "powerful").
Name things by what they are.

## When done
Show:
1. the diff
2. the grading table (slide requirement | README sentence | proving file | pass or gap)
3. the list of TODOs I still need to fill in
4. anything from these rules that the repo still doesn't meet
Then wait for "go".
