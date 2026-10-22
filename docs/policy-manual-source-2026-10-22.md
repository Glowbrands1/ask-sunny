# Corrective Action policy source — verification record (22 Oct 2026)

Owner decision (22 Oct 2026): keep the JBA Policy Manual as the source Ask Sunny cites on a
Corrective Action Form, but verify that it is the approved and applicable source for Sun Tan City,
and mark it as requiring owner confirmation where approval cannot be established independently.

All evidence below was read with read-only `SELECT`s against the Ask Sunny project
(`rbkylaavthsjepsczccv`). Nothing was written, tagged or re-configured.

## The document Ask Sunny resolves

| | |
|---|---|
| Document id | `ce6b00f1-ff30-565f-b446-53fd268a1695` |
| Title | JBA Policy Manual Edited 5.2025 (cover: "2025 JB & Associates Employment Policy Manual — Revised May 2025") |
| File | `JBA-Policy-Manual-Edited-5.2025.pdf`, version 1, 166 chunks |
| Knowledge scope | `stc-core` (Sun Tan City) |
| Source | Woven sync (`tags: woven, woven-handbook`), indexed 29 Sep 2026 |
| How it is found | **By name** — the `JBA-Policy-Manual` filename prefix (`OFFICIAL_POLICY_MANUAL.fallbackFilenames`). No document carries the `official-policy-manual` tag. |
| Supersedes | `f527da34…` (same title, manual upload 7 Sep 2026, now `superseded`) |

Other indexed JBA documents in the same scope ("JBA Policy Manual 2025", "… 2024 … Edited 10-2024",
"… 2025 … with acknowledgement") do not match the filename prefix and are not selected. The 2024
edition is still indexed; it is never cited because resolution is by identity, not similarity.

## Applicability to Sun Tan City (from the manual's own text)

The manual's wording is not reproduced here (the repository is public); this is a paraphrase.

* Page 1: the manual covers every brand JB & Associates, Inc. operates.
* Table of contents (page 3) lists a **Sun Tan City** dress-code section beside the other brands.
* **Attendance** (PDF page 15, printed page 14): applies to every employee with no brand exception, and
  counts meetings, seminars and training sessions as scheduled shifts, pointing to the Seminar/Webinar Attendance section.
* **Seminar/Webinar Attendance** (PDF page 38): not attending an enrolled seminar *without notifying the
  Supervisor* counts as a no call no show.

So the text supports applying both sections to STC employees. Whether Sun Tan City is still operated
under this manual, and whether this May 2025 copy is the current one, is a business fact the text
cannot establish.

## Approval status: **requires owner confirmation**

No approval record exists for this document as Ask Sunny's Corrective Action source: it is untagged,
and its presence in the Knowledge Base (or in Woven) is not treated as approval.

What the code now does (this branch):

* A draft quoting this manual carries the notice *"Policy source: "JBA Policy Manual" (JBA Policy Manual
  Edited 5.2025) requires owner confirmation as Ask Sunny's approved policy manual …"*; the chat card says
  the same on its **Policy source** line. The provenance stored with the value keeps `matchedBy: "fallback"`.
* Policy language is still retrieved from the resolved manual's chunks (never a hard-coded quotation)
  and cited as `Source: JBA Policy Manual — <section>, p. <printed page>`.
* A missed meeting is not written up as a no call no show unless the manager says the employee did not
  notify anyone; where the policy is uncertain the chat asks and the draft is left as it is.

**To confirm** (an owner action, not done here): tag document `ce6b00f1…` `official-policy-manual` in the
Knowledge Base. The mark then disappears with no code change.
