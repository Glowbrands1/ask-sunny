# QA evidence — Ask Sunny — 22 Oct 2026

Final QA of branch `claude/lucid-shannon-v79zju` at `4ee4c1b` (ON HOLD: no PR, no merge, no deploy).

| File | What it is |
|---|---|
| `FINAL_QA_VERDICT.md` | **The verdict for this app**: SHAs, exact test counts, changed expectations, remaining defects, browser and saved-form evidence, isolation, recommendation, remaining actions |
| `QA_FINDINGS.md` | Final status of every finding, then the initial findings as first reported |
| `REGRESSION_MATRIX.md` | Every probe scenario for this app, branch vs `main`, plus the browser runs (generated from `evidence/final-probes/`) |
| `TEST_CHANGE_AUDIT.md` | Every changed test expectation with its justification; fail-before / pass-after counts |
| `PARITY_REPORT.md` | What is level with the sibling app, intended differences, the cross-app isolation check |
| `evidence/full-suite/` | Full `npm test` logs (vitest JSON reports gzipped), `tsc`, `eslint`, `steps.txt` |
| `evidence/final-probes/` | Raw probe output (JSON + log) for this app's branch and `main` |
| `evidence/probe-sources/` | Probe sources (`.ts.txt`: copied into `src/__qa__/` to run, never committed as tests) |
| `evidence/browser/` | Playwright: structured results (`*-browser.jsonl`), logs, screenshots, the harness (`.txt`) |
| `evidence/fail-before/` | New QA tests run on the commit before their fix, and on the final head |
| `evidence/baseline/` | Full suite on the QA baseline before any fix; skipped-test inventory |
| `evidence/integration-steps/` | Logs from integrating each fix group |
| `evidence/initial-probes/` | The first probe round (before any fix), incl. the bisect for finding A (Sunny) |
| `evidence/isolation-check.txt` | Cross-company data and terminology scan of every line the branch adds |

The cross-app documents mention the sibling app; its location names and ids are replaced with ‹markers› here so this repository holds no data from the other company. The unredacted versions of the shared documents differ only in those markers. All people, accounts and records in this evidence are synthetic; no production or historical HR record was read or changed.

Raw test-runner output (`evidence/full-suite/`, `evidence/baseline/`) reproduces this repository's own test titles verbatim; some of those pre-existing titles name the other company because they are this app's tenant-isolation guards. That output is unedited.
