# AI Test Triage Demo 🔎

A small demo that asks an LLM to **classify why each failing test failed** in a nightly regression run:

| Category | Meaning | How the demo produces it |
|---|---|---|
| 🐞 `PRODUCT_BUG` | The application is wrong, the test is right | saucedemo `problem_user`: last name field can't be filled, sorting is broken |
| 🧪 `TEST_BUG` | The test code is wrong | Wrong locator, wrong expected value |
| 🌩️ `ENVIRONMENT` | Infrastructure / environment issue | httpbin `503`, a staging host that doesn't resolve in DNS |
| 🎲 `FLAKY` | Timing / race condition | A button enabled after a random 0–2 s delay, borderline timeouts |
| 🗃️ `TEST_DATA` | Test data issue | Locked-out user, deleted booking record (404) |

The **true** category of every broken test is stored in `expected.json`. Because the tests were broken on purpose, the classifier's accuracy can be measured automatically.

> Test names and log messages are in Turkish; the code and this README are in English.

## Results

Same 9 failing tests, classified three ways:

| Method | Correct | Misclassified |
|---|---|---|
| Rule-based (regex) | 8/9 (89%) | "two products → cart badge shows 2" |
| LLM, run 1 | 8/9 (89%) | payment service health check |
| LLM, run 2 | 7/9 (78%) | payment service health check, stock service |

- The LLM caught the one bug rules can't: the test **name** says two products are added, the **code** adds one. You only see that by reading the code.
- The LLM's "miss" on the payment service was arguably correct: the test calls `httpbin.org/status/503`, and the model pointed out that this URL always returns 503, so the problem is in the test. The simulation itself was a giveaway.
- The only decision that changed between runs was made with **60% confidence**. All decisions with ≥ 80% confidence were identical in both runs, so low-confidence results are a good candidate for human review.

## How it works

```
Playwright (N runs) ──► results/history/*.json ──┐
                    └─► results/latest.json ─────┤
                                                 ▼
            triage.ts: error + stack + test code (comments stripped)
                       + run history + page snapshot at failure
                                 │  masking (tokens, emails, national ID, card, IBAN)
                                 ▼
                LLM (Claude / OpenAI / local Ollama) ──► JSON verdict
                                 ▼
             results/triage.json + triage-report.md (+ Slack)
                                 ▼
                     evaluate.ts ──► accuracy + confusion matrix
```

Each verdict looks like this:

```json
{"category": "TEST_DATA", "confidence": 0.95, "reason": "The page shows 'Sorry, this user has been locked out.'", "suggested_action": "Use a non-locked user for checkoutUser"}
```

## Setup

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
cp .env.example .env   # add an LLM key (or configure Ollama)
```

## Usage

```bash
# 1) Run the suite 10 times to build flaky history. Red tests are expected.
npm run test:history

# 2) Rule-based baseline (no API key needed)
npm run triage:baseline

# 3) LLM triage
npm run triage

# 4) Compare both against expected.json
npm run evaluate -- results/triage.json results/triage-baseline.json
```

## LLM options

| Option | `.env` | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY=...` | Default model `claude-sonnet-5-5`, override with `LLM_MODEL` |
| Anthropic (key not scoped to a workspace) | `ANTHROPIC_API_KEY=...` + `ANTHROPIC_WORKSPACE_ID=...` | Needed if the API returns *"This API key is not scoped to a workspace"*. Take the ID from the **same** organization as the key |
| OpenAI | `OPENAI_API_KEY=...` | Default `gpt-4o-mini` |
| **Ollama (local)** | `OPENAI_BASE_URL=http://localhost:11434/v1` + `LLM_MODEL=qwen2.5:14b` | Data never leaves your machine. Safest option for company code |

If an LLM call fails, that test falls back to the rule-based classifier and the report says so (`(LLM hatası, kural tabanlı)`).

## Design notes

- **No answer leakage:** The demo tests contain comments like `// ❌ TEST_BUG`. Comments are stripped before the code is sent to the model; otherwise the evaluation would be meaningless. Playwright's `error-context.md` also contains the commented test source, so only its page-snapshot section is ever used.
- **Fixed categories + JSON output:** An enum and a confidence score instead of free text make the result measurable and easy to wire into automation.
- **Run history:** "Failed 6 of the last 10 runs" is the strongest signal for telling flaky tests apart from consistently failing ones.
- **Page snapshot:** `tests/fixtures.ts` attaches the page's accessibility tree (falling back to `innerText`) when a test fails. Without it, nothing can tell that the checkout user is locked out: the error message only says the URL didn't change.
- **Masking:** see `triage/mask.ts`. Add project-specific values with `MASK_VALUES`.
- **Flaky tests** don't fail every run. Evaluation only covers tests that failed in the latest run.

## Adapting it to your project

- Prompt and category definitions: `triage/classify.ts` → `SYSTEM_PROMPT`
- Rule-based baseline: `classifyBaseline()` in the same file
- New broken tests must also be added to `expected.json`
- UI specs should import `test` from `./fixtures` to get page snapshots
- CI: `.github/workflows/triage.yml` (secrets: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, optional `ANTHROPIC_WORKSPACE_ID`, `SLACK_WEBHOOK_URL`)

## Troubleshooting

| Symptom | Cause |
|---|---|
| `0 başarısız test` (0 failed tests) | Tests didn't run. Run `npx playwright test --list`, which should show 14 tests. A file saved without the `.ts` extension (e.g. `tests/fixtures`) breaks loading |
| `LLM ayarlı değil` (LLM not configured) | No key found in `.env` |
| `401 invalid x-api-key` | The key was copied from the Console's key list, which only shows a masked preview. Create a new key and copy it from the creation dialog |
| `credit balance is too low` | No API credits in the organization that owns the key |
| `404 Workspace not found` | `ANTHROPIC_WORKSPACE_ID` belongs to a different organization than the key |

## Note

saucedemo.com, the-internet.herokuapp.com, restful-booker and httpbin are public sites built for test practice. Please keep the number of runs reasonable 🙂
