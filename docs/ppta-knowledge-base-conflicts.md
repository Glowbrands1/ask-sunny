# PPTA in the knowledge base — what conflicts, and what Paulyne must change

The review's finding: *"The employee framework calls it Product Productivity
Average and directs Sunny to verify the formula elsewhere."*

Every indexed chunk mentioning PPTA was searched. This records exactly what was
found, what the app now does about it, and the one thing only Paulyne can do.

## 1. The authoritative definition

    PPTA = Product Sales ÷ Total Tans

Held in one place, `src/lib/reporting/ppta.ts`, and traced to the live delivery
in `docs/ppta-trace-2026-09-14.md`. Every app-owned copy — metric map, briefings,
analysis prompt, report pages, Sales Totals cards — derives from that constant.

## 2. What the knowledge base actually says

Fifty-seven indexed documents; nine mention PPTA. Only four define it.

### 2.1 Stale — `ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT`

Document `2d6a585c-9100-401c-8acc-b41d080736a6`, chunk **15**, locator
`PRODUCTIVITY AND OTC-RELATED METRICS`:

> Metric: PPTA
> Plain-English Definition: **Product productivity average.** At the employee
> level, use PPTA as the signal of whether the employee is consistently
> recommending products during client interactions. **Exact calculation should
> be verified from the official reporting guide if the report does not show the
> formula.**

This is the passage the review found. Two problems: an acronym expansion in
place of a formula, and an explicit instruction to look the formula up
elsewhere — which is why Sunny deferred instead of answering.

The document's other nine PPTA mentions are coaching context ("high visits with
low PPTA") and carry no definition. They are fine.

### 2.2 Stale — `ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK`

Document `4e2162e8-1e9c-4528-8931-65d017b79d2b`, chunk **9**, locator
`PRODUCTIVITY METRICS`:

> Plain English Definition: **Product productivity average.** In Daily Stats,
> use PPTA as the product sales productivity indicator **tied to
> tanning/client interactions.**

Same acronym expansion, no formula, and "tied to tanning/client interactions" is
vague enough to be read as per-transaction or per-visit.

### 2.3 Correct — leave alone: `ASK SUNNY BONUS VIEWER FRAMEWORK KB TEXT`

Document `dca3415e-6950-4d79-839f-fd061219be62`, chunk **11**:

> Metric: **Unique PPTA**
> Plain English Definition: Product sales per unique tanner for the month.
> Current policy defines it as Total Product Sales divided by Total Unique
> Tanners.

**This is right.** Unique PPTA is a different measure, correctly named and
correctly defined, and it matches `UNIQUE_PPTA_DEFINITION`. It must not be
edited, and Sunny must not tell anyone it is out of date.

### 2.4 No definition — no change needed: `Salon Director Manual 3.2026`

Chunk 45 lists PPTA among primary productivity measures without defining it.

## 3. Neither stale passage states a WRONG formula

Worth being precise, because it changes the fix. Neither document says PPTA is
something else; both **omit** the formula, and one tells the reader to go and
find it. So the knowledge base does not contradict the app — it fails to answer,
and the deferral is what produced the reviewer's experience.

## 4. What the app now does (done on this branch)

`REPORT_DATA_RULES` travels with every report block, and `ppta` is a routing
keyword for Sales Totals, so any question mentioning PPTA carries these rules
even when the answer comes mostly from a document. The rules now:

- state the formula;
- **name both stale documents**, so Sunny can tell a manager which one is
  behind rather than saying "some documents disagree";
- forbid repeating "verify the calculation elsewhere" — the deferral that
  caused the original answer;
- **protect the Bonus Viewer document** from being contradicted.

Pinned by `report-briefing.test.ts`.

## 5. What only Paulyne can do

The documents live in `knowledge_documents` / `knowledge_chunks` in Supabase.
They are uploaded artifacts; there is **no editable source in this repository**,
so a code change cannot correct them. Correcting them means re-uploading through
the Knowledge screen, which is a production data change and is out of scope for
this branch.

**Two edits, both one sentence.**

**Edit 1 — Employee Performance Framework**, section `PRODUCTIVITY AND
OTC-RELATED METRICS`, the `Metric: PPTA` entry. Replace:

> Plain-English Definition: Product productivity average. At the employee level,
> use PPTA as the signal of whether the employee is consistently recommending
> products during client interactions. Exact calculation should be verified from
> the official reporting guide if the report does not show the formula.

with:

> Plain-English Definition: **PPTA is Product Sales divided by Total Tans** —
> product revenue per tanning session. At the employee level, use it as the
> signal of whether the employee is consistently recommending products during
> client interactions. It is not money per transaction and not an average
> ticket. Product sales per unique tanner is a different measure, Unique PPTA,
> which belongs to the Bonus Viewer.

**Edit 2 — Daily Stats Interpretation Framework**, section `PRODUCTIVITY
METRICS`, the `Metric: PPTA` entry. Replace:

> Plain English Definition: Product productivity average. In Daily Stats, use
> PPTA as the product sales productivity indicator tied to tanning/client
> interactions.

with:

> Plain English Definition: **PPTA is Product Sales divided by Total Tans** —
> product revenue per tanning session. In Bonus Viewer, Unique PPTA is the
> month-to-date product productivity per unique client, which is a different
> measure.

### Where the source files are, and what format each is

Both originals are retained in Supabase Storage, bucket `knowledge-documents`.
**They are not the same format**, which changes how each is edited:

| Doc | Storage path | Format | Size |
|---|---|---|---|
| 1 — Employee Performance Framework | `stc-core/2d6a585c-9100-401c-8acc-b41d080736a6/v1/ASK_SUNNY_EMPLOYEE_PERFORMANCE_FRAMEWORK_KB_TEXT.txt` | **plain text** | 74,383 bytes |
| 2 — Daily Stats Interpretation Framework | `stc-core/4e2162e8-1e9c-4528-8931-65d017b79d2b/v1/ASK_SUNNY_DAILY_STATS_INTERPRETATION_FRAMEWORK.docx` | **Word (.docx)** | 66,376 bytes |

Document 1 is edited in a text editor. **Document 2 is a Word document** — open
it in Word, change the one paragraph, save as `.docx`, and re-upload. Do not
convert it to text on the way: the extractor reads `.docx` directly, and
converting changes how it chunks.

Download each from the Knowledge screen (the document's original-file link) or
from the Storage browser, edit the one paragraph named above, and re-upload
through Knowledge so it re-indexes and the chunks are replaced.

### Verifying it worked

After re-indexing, the stale sentence must be gone and the new one present.
Search the Knowledge screen for "Product productivity average" — it should
return **nothing** from these two documents. It will still return the phrase
nowhere else, because no other document uses it.

The app rules in §4 stay regardless. They cost nothing once the documents are
correct and they protect against a future upload reintroducing the deferral.

## 6. Verified — no stale app-owned copy remains

Every PPTA definition in the repository derives from `PPTA_DEFINITION`. Tests
covering it: `ppta.test.ts`, `report-briefing.test.ts`,
`sales-totals-briefing.test.ts`, `sales-totals-context.test.ts`,
`sales-totals-aggregate.test.ts`.
