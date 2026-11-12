# Gate-Sunny-3 — #905 NEXT_PUBLIC_REPLY_QUOTE_LINES_ENABLED — GO (head 4316bffb)

- The full runs are on `8d503b1dc` (contains main `7e8dcdb6f`; no conflicts; tsc clean). `4316bffb` adds one
  test-only commit: `src/components/rich-text.tsx` added to flags-off-parity's UI excludes (QA-approved).
- Change: `src/components/rich-text.tsx` only (client renderer). With the flag on, a run of "> " lines renders as one
  `<blockquote>`, a line each, and a bare ">" becomes a gap. Off, the renderer is unchanged.
- Three full runs, production flags in the env: main 7e8dcdb6f, PR with the flag off, PR with the flag on.

| | tests | passed | failed |
|---|---|---|---|
| main | 22,164 | 20,766 | 1,264 |
| PR OFF | 22,167 | 20,766 | 1,267 |
| PR ON | 22,167 | 20,768 | 1,265 |

- **Replay text is byte-identical** for main vs PR OFF and for PR OFF vs ON (1,673 records). Expected for a
  client-only change.
- The 3 new `rich-text.dom.test.tsx` tests pass ("flag on: each quoted line is its own line …", "a bare '>' is a
  gap", "flag off: as before").
- flags-off-parity "does not edit Pau's modules or any UI file" fails on 8d503b1d. On 4316bffb it passes, which
  is what that commit is for.
- The other flips in the full runs (card-change, exit-title-label-words, live-flags-with-reader, same-form-copy,
  corrective-action-dm-feedback, form-revisions, create-currency-audit, chat-trace.migration): those 8 files, run
  alone, give **the same 55 failures on main, PR OFF and PR ON** (310/313/313 tests; the extra 3 are the new
  rich-text tests). Load noise.
- Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

0 REGRESSION. **GO** on 4316bffb. No replay case is tied to this flag; the fix is checked by the rich-text DOM tests.
