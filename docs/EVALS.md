# Evals (Phase 6)

Two layers. The deterministic layer always runs (`npm test`); the live layer calls Gemini and runs on every PR (`evals-live` in CI).

| Layer | What | Where | Needs a key |
|---|---|---|---|
| Rules | T01-T20 expected intent/outcome/decline reason/priority, from hand-extracted "perfect" facts through `decide()` | `tests/evals/golden.test.ts` | no |
| After-hours | T08 (10:47 pm missed call) and the two early-morning calls (T07 09:44, T20 09:15) are outside 10:00-19:00 IST | same | no |
| Email privacy | every handoff + reminder email built for each qualified call contains no transcript sentence and no full phone number | same | no |
| Leak detector | the detector itself (catches ₹, lakh/crore, per sq ft, "rate", rupees, digits beside currency/area words) incl. false-positive cases | `tests/evals/leak-detector.test.ts` | no |
| **Classification (live)** | real extraction (Gemini) + rules on every transcript vs `evals/expected.json` | `npm run eval:classify` | yes |
| **Price-leak (live)** | the real rendered agent prompt under 14 adversarial pricing scenarios, N samples each; FAILS on any figure | `npm run eval:leak` | yes |
| End-to-end via Vaani | scripted playground calls | `docs/E2E.md` | Vaani key + deploy (**not run yet**) |

## Latest live results (gemini-3.8-flash)
- Classification: 20 cases × 3 runs = **60/60**. First run was 16/20 and found three real bugs, now fixed in `lib/classify.ts`:
  a dropped call became a "qualified lead"; an undiscussed timeline wrongly produced a "note" outcome; a too-small commercial space
  was reported as "out of scope" instead of "too small".
- Price-leak: 14 scenarios × 3 runs = **42/42** clean, including Hindi, Marathi, a prompt-injection attempt, and the two low-budget cases
  (agent says the budget is likely below what such a project costs, without a figure). Against a deliberately naive prompt the same eval
  fails 14/14 and exits 1, so it does catch leaks.

## Decisions to know about
- **Area-word exemption:** the brief fails any reply with "a digit adjacent to a currency or area word". The detector applies that strictly,
  except an area figure the **caller** said (echoing "your 950 sq ft" is not a price). Currency figures are never exempt.
- **Unresolved rules stay in config**, and the evals prove they matter: T02 (moves in ~9 weeks) flips to "timeline" at `min_completion_weeks = 10`;
  T18 flips at `commercial_min_sqft`. Nikhil should confirm both numbers.
- **T17** is two calls: T17a (line dropped) must be *abandoned*, T17b (the callback) *qualified*.
- **Model drift:** `GEMINI_MODEL` can change under us (gemini-2.5-flash was already retired for new keys). Pin it in CI with the repo variable `GEMINI_MODEL`.
- **Cost:** a full live run is about 100 model calls (60 classification + 42 replies); a PR run (2 + 3 samples) about 80.

## CI setup (when the GitHub repo exists)
Add repository secret `GEMINI_API_KEY` (and optionally variable `GEMINI_MODEL`). Fork PRs skip the live job with a warning; a same-repo PR
without the secret fails on purpose.
