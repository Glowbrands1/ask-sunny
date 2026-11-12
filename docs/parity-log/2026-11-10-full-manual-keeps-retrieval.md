## 10 Nov 2026: FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED — Ask Sunny now matches Ask Bubbles

**Not needed in Ask Bubbles: Bubbles already works this way.**

In this app, with FULL_MANUAL_CONTEXT on (production), a turn the normalizer labels "policy" put only the JBA Policy
Manual in the prompt and set the retrieved rows to none (`server-ask.ts`, the `full_manual` stage). Questions about
another document were answered "I don't have that". QA's finding, Sunny live 10 Nov 2026 19:12–19:13Z:
conv_mwb2gsx52k6reh7, conv_mwb2iugw2fxzr9z: "I don't have a Tanning Consultant Manual in the knowledge base", although
the TC Tanning Consultant Manual is indexed.

With FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED (default off), retrieval still runs on that path. Rows from documents other
than the policy manual (and not another brand's) are given beside the manual as [S#] sources and cited
(`ai/full-manual-keeps-retrieval.ts`).

Ask Bubbles' FULL_MANUAL_CONTEXT (`server-ask.ts`, `loadFullManualPlan`) already adds the manual beside the retrieved
rows: retrieval always runs, and only the multi-brand manual's own rows are left out of the [S#] sources. Bubbles has no
change to port.

Follow-up, not in this change: on this path the query rewrite turned "how do I reset the spray tan equipment after
cleaning it…" into the policy manual's heading "Care and Cleaning of Equipment and Facilities"
(conv_mwb2hmb62lroh57), so the search found the TC manual's contents page, not its cleaning section.
