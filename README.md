# Handover Ledger

When someone moves on, the next person should not have to chase them to learn what was decided, what is unfinished, who owned what, and where the risk sits. Handover Ledger turns what the leaver writes (and what the issue export and commit log say) into a brief in which every line quotes its source.

**Built by Tab, an AI assistant, for Akshay Wagh's CodersInPune Round 2 entry (team Tab x Akshay).** No human wrote this code. No login is needed.

## Try it

Open the live page. It loads with a sample handover already in it.

1. **Capture**: add entries (notes, an issue CSV, or a commit log). Each sentence becomes a claim, and each claim keeps its exact quote.
2. **Handover brief**: owners, decisions, open items and risks, built automatically. Accept or reject lines. Answer the questions the sources leave open. Download the brief as Markdown.
3. **New owner**: what a successor should rely on, what is unreviewed or disputed, and what is not known yet.

## What it does (Round 2 scope)

- Three source connectors: free notes (sentence split), issue export CSV (header row), commit log lines.
- Rule-based claim extractor (no model call): owner, decision, open item, risk, activity.
- Quote validator: a claim is kept only if its quote is the exact span it names in its source. Planted false claims are injected on every build and must all be dropped; the page shows the count.
- Owner conflicts: two owners for the same subject with no newer claim become a gap question, not a silent choice. A newer claim that says "now" supersedes older owners.
- Gap questions: answers are stored as leaver-attested sentences and run through the same rules and validator.
- Review queue with an audit log (accept, reject, entry added, answer).
- Markdown export of the brief.

## Run the tests

```
npm test                       # Node unit tests for the logic (no dependencies)
python3 tests/e2e_playwright.py http://127.0.0.1:8765/   # browser flow, fresh context
```

The page is plain HTML, CSS and ES modules. No build step, no dependencies. Serve the folder with any static server, e.g. `python3 -m http.server 8765`.

## Files

- `handover.js`: the logic (extraction, validator, conflicts, gaps, brief). No DOM.
- `app.js`, `index.html`: the three views.
- `demo.js`: the sample handover.
- `tests/handover.test.mjs`: unit tests. `tests/e2e_playwright.py`: browser flow.

## Limits (honest)

- Extraction is rule-based. It finds what it can phrase-match ("owns", "decided", "open", "risk") and misses the rest. The brief says what it found, and the quote lets a reviewer check it.
- State lives in the browser's local storage. There is no server and no shared database.
- Not built yet: role-scoped permissions, contradiction and supersession across many sources, PDF export, connectors beyond the three above. These are the Round 3 commitments in the submission pack.

Disclosure: drafted and built by an AI assistant under Akshay Wagh's direction, as the Round 1 proposal states.
