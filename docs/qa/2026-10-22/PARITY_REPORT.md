# Parity report — Ask Sunny vs Ask Bubbles (22 Oct 2026, final)

Final heads: Sunny `4ee4c1b`, Bubbles `2ea0a93` (branch `claude/lucid-shannon-v79zju`, not merged). Sections 1–6 below are the parity review as first reported (heads `9548afb` / `ce03a64`, original kept at `(the QA master folder) PARITY_REPORT.initial.md`); section 0 is the final state after the fix round.

## 0. Final state after the authorized fix round

Every QA fix was made in **both** apps, each against its own code and its own data (one commit per fix, same subject line in both repos). Where one app already behaved correctly, the other got the fix and the correct app got a guard test with the same sentences.

| Fix | Sunny | Bubbles | Same result on the probes? |
|---|---|---|---|
| F-01 negated/waived payroll is never Yes | `5b208c5` | `c527329` | yes — 6/6 both; browser No×3 / Yes both |
| F-04 "write a …" is a form request only when a form is written | `38f9290` | `9ffbf5b` | yes — 4/4 both |
| F-11 prior records attached only when the name is one person; possible matches shown with location, never saved | `7ef0e1a`, `d52a3fa` | `95d0224`, `dea1646` | yes |
| F-05 times/prices/quantities after "at" are not locations | `de490a3` (fix) | `cca056e` (guard tests; Bubbles never had the defect) | yes |
| F-03 date the form by what each date means; ask when several | `7c4fa18` | `614e1fd` | yes — C1–C5, X4, X8 both |
| F-07/F-08 earlier coaching however it is said; no false escalation | `23b285a` | `64fd694` | yes — AC3 24/24 both |
| Spelling: manager's typed name kept unless an exact directory match | `cf8bdd6` | `6ad7e59` (+ `2ea0a93` one missed expectation) | yes — browser saves `pat rivera` in both |
| F-02 a reply that names a location never replaces the employee | `8ae0147` | `2d8725b` | yes — L/M/X rows; browser AC1 both |
| F-09 a role before the name names the subject | `d0e197a` | `d2589cb` | yes — 3/3 both |
| F-06 two people in one request is never a form for one | `b24882e` | `6c5a14a` | **intended difference:** Sunny asks which person; Bubbles offers one card per person (its existing two-forms-from-one-message feature `01fa914`). Neither picks one silently |
| F-12 a location reply keeps the open form; only an authorized location is set | `1ebbf60` (new `salon-reply.ts`; `authorizeLocation` unchanged) | `e8cdcc8` (extends `store-confirmation.ts`) | yes — identifiers 20/20 Sunny, 17/17 Bubbles; browser AC1 both |
| F-03d "dated 10/20" ends a typed name | `2eaf93e` | `999ac00` (guard; Bubbles already correct) | yes |
| X2 "no, keep it verbal" takes the level back | `4ee4c1b` | `cf694d2` (guard; Bubbles already correct) | yes |
| Several incident dates → "Which date goes on the form?" (finding C) | ported in W4 (`7c4fa18`) | already (`9c02dcb`) | yes |

**Section 2 below ("defects now shared") is fully resolved**: F-01, F-04, F-08 and F-09 are fixed in both apps. **Section 5**: "several incident dates" is now level; "bare number after at" (F-05) is fixed; "names printed capitalised" is resolved by your decision (typed spelling kept in both). The other section-5 items remain open decisions, unchanged.

### Cross-app data isolation and terminology (final check, `evidence/isolation-check.txt`, `tools/isolation_check.py`)
| Check | Sunny | Bubbles |
|---|---|---|
| Other company's data tokens (location names, ids, aliases, district names, company names) in lines added by the branch, code + tests | **0** | **1** — `qa-w2-employee-reading.test.ts:69`, the word "Lawrence" in a guard test asserting Bubbles does **not** treat it as a store (its own roster decides). Not data copied from Sunny; no Sunny id, alias or mapping |
| Comments naming the sibling app (provenance only, no data) | 27 | 4 (tests only; production code uses "the reference platform" per the tenant-isolation guard) |
| Wrong location word in user-facing production strings | none user-facing — the 8 "store" hits are Sunny's Google **store-code** handling (an import and comments about "store 373"), the word list that ends a salon name, a role pattern ("store manager"), and one provenance comment | **0** "salon" literals |
| Each app's location resolver/authorizer used | `salon-mention.ts`, `salon-reply.ts`, `authorizeLocation` / `authorizedSalonIds` | `stores/resolver.ts`, `store-confirmation.ts`, `authorizedLocationIds` |
| Test fixtures use own roster | yes | yes after `5ee3298` (a copied Sunny `loc-0310` fixture replaced with `‹Bubbles store id›`) |
| Tenant-isolation guard test (`tenant-isolation.test.ts`) | n/a (Sunny has no such guard) | passes (full suite) |
| District/region access | fail-closed (403) | fail-closed (403; no district roster) |
| Access inferred from a name or number alone | never — every resolved location goes through the authorizer; forged ids → 403 in route probes and the browser | same |


Bubbles is a port of Sunny (`Ask-bubbles/docs/chat-parity.md`): same chat, forms intake, Corrective Action engine, policy citation, access model and Woven sync, with different company data. "Branch" = `claude/lucid-shannon-v79zju` (Sunny `9548afb`, Bubbles `ce03a64`), not merged.

## 1. Mirrored by the branches (behavior now the same in both, once merged)

| Area | Fix | Into Sunny | Into Bubbles |
|---|---|---|---|
| Chat UI | Conversation kept in the address; reload reopens it | `05993d2` (← `c32eb59` + Sunny `0090bef`) | already |
| Chat UI | Confirm before deleting a conversation / finalizing a form | `415e0d2` (← `fe871f1`) | already |
| Chat UI | Links/buttons ≥ 24 px | `025b5d5`, `952c128` | already |
| Forms UI | Browser autofill off on typed form fields | `988ab71` (← `062e5dc`) | already |
| Chat UI | "Create a form" only for accounts that may create one | `af17a18` (← `987e4b7`) | already |
| Forms card | After Save the card reloads; a refused finalize opens the policy dialog | already (`cf1480b`) | `ffab76e` |
| Policy notices | "Woven does not see this policy in the knowledge base" | already | `fdcea02` |
| CA | Employee's forms already on file listed as prior actions | already (`1d63aeb`) | `5f72447` |
| CA reading | "write a CA for X"; payroll answers in HR's wordings; one employee's answers kept off another's form; friend/coworker not the employee; earlier coaching's purpose kept; "verbal, payroll deduct no." | `2f9417a`, `48d179b`, `568a10e`, `4edb627`, `30d8c6f`, `ac0ece3` | already |
| Intake | Lower-case/all-caps names, possessives, punctuated locations; "my employee <name>"; intake kept open on a location or "I already told you"; CA offered after coaching + repeat | `38dad49`, `fac0f44`, `dc5e7a6` | already |
| Admin | Exact-title knowledge supersede; `/api/health` in demo; observable template sync; interrupted publish finished | `9f89667`, `d98b9b2`, `ee849df`, `55e81f4` | already |

Probe confirmation: on the branches, the 41/42-scenario conversation probe gives the same result in both apps for A1–A7, B1–B2, I1–I4, M1, M3–M4, F1–F4, R2–R6 (`REGRESSION_MATRIX.md`).

## 2. Defects that are now shared (were Bubbles-only, the branch copies them into Sunny)

Porting a fix carries its bugs. These are on Bubbles `main` today and become Sunny behavior if the Sunny branch is merged as is:

| Finding | Bubbles main | Sunny main | Sunny branch |
|---|---|---|---|
| F-01 negated/waived payroll deduction read as **Yes** | yes | null (asks) | **yes** |
| F-04 "write a summary/note/email …" read as a CA request | yes | no | **yes** |
| F-09 "for the manager Jane Doe" / "her coworker Amy Lee" → no employee | yes | name read | **yes** |
| F-08 escalation signal fires on non-performance repeats | yes | no | **yes** |

Recommendation: fix these in **both** apps in one change each, before merging either branch.

## 3. Defects present in both apps on `main` (pre-existing)

F-02 location-only reply overwrites the employee · F-06 two people → one picked · F-07 previous coaching phrasing (CA path: Sunny 7/12, Bubbles 9/12; offer path: 4/12 each) · F-10 district/region managers cannot file at any location · F-11 prior-forms name matching across all visible locations · F-12 a suggestion picker ends an open intake.

## 4. Intended differences (keep)

| Topic | Sunny | Bubbles | Why |
|---|---|---|---|
| Location word | salon | store | company language |
| Forms list | Form Monitoring | Forms Register | company language |
| Policy source | JBA Policy Manual | JBA Policy Manual **read as Buff City Soap** (`config/company/knowledge.ts`) | same manual, brand-scoped reading (the earlier `CLAUDE.md` "↔ Buff handbook" mapping was wrong; corrected, uncommitted) |
| Location roster | 15 salons with districts/regions; Google store codes | stores with no districts yet (fail closed) | data not confirmed for Buff |
| Store resolution | `salon-mention.ts` (nicknames, Google codes) | `stores/resolver.ts` + Woven aliases, title verification, chat-side people lookup (`ffea279`, `efde160`) | Bubbles feature; porting is an open decision |
| District filing | refused ("cannot yet verify which salons are in your district") | refused (no district roster) | both fail closed |
| Reviews | Apify + GBP anchors (posted-date fix `76b2b85`) | GBP API, counts by Google's create time | different pipeline |
| EFTs, KS Manhattan district, Sun Tan City / Buff City content | Sunny only | Bubbles only | company data |
| Playwright e2e | none | `e2e/` (demo build) | Sunny never had one |

## 5. Still different — open decisions (not ported)

| Item | Sunny | Bubbles | Note |
|---|---|---|---|
| Several incident dates | first date used silently | asks "Which date goes on the form?" (`9c02dcb`) | QA recommends porting to Sunny (finding C) |
| Every form built only from its own turns | CAs and employment changes only | all forms (`a73ef6c`) | |
| Two forms from one message; "which one?" for a correction | no | yes (`01fa914`, `8b79a46`) | |
| Admin grants limited to the admin's own areas | no | yes (`2123821`) | |
| Same-origin guard on Apify review-sync admin routes | no | n/a | Sunny-only hardening |
| Bare 3-digit number after "at" read as a salon | **branch only** (F-05) | n/a | revert or restrict before merge |
| Names printed capitalised | branch (deliberate) | yes | confirm the 30 Sep rule change |

## 6. Keeping them level (process)

`CLAUDE.md` (per repo) now requires each chat/forms/CA/access fix to be checked against the sibling and either ported or logged in `docs/parity-log.md`; `.github/pull_request_template.md` adds a "Sibling app" section; `.github/workflows/ci.yml` runs lint, typecheck and the full suite on every PR. QA addition recommended: every new reader ships with **negative** cases (F-01/F-04/F-05/F-08/F-09 all passed their own positive tests).
