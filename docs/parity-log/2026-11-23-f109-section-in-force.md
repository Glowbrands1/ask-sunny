# Board f109: the section in force, read from the manual's own headings (the disability text was cited as Immigration Law Compliance) — same bug in Ask Bubbles, port pending

**Report (QA, 23 Nov 2026):** Sunny's disability text was labelled "Immigration Law Compliance p.9".

**Cause (production's rows):** ingestion does not always advance a chunk's `section` at a heading printed inside the
chunk's text. Chunks 24–26 are stored under "Immigration Law Compliance" while chunk 25's text holds the "Disability
Accommodation-Americans with Disability Act" heading line and chunk 26 is all disability text, so every reader citing
those chunks named the lagging section. `metadata.sections` alone cannot settle it: it lists the disability heading for
chunk 24 too, whose text is all immigration.

**Fix (the reader, no word list):** `withSectionsInForce` (`official-policy-manual.ts`) labels each chunk with the
section in force, read from the manual's own structure:

- the heading set is every chunk's stored section and every heading its own `sections` names;
- a content line starts a section only when its key is in that set AND ingestion recorded that heading as printed on
  this chunk's page (a short heading such as "Eligibility" is an ordinary line elsewhere);
- a heading carries into the next chunk only while the stored section stays the one it lagged under and that chunk's own
  `sections` names it too;
- each chunk takes the heading covering most of its text; only a stored section that LAGGED is replaced (the chunk does
  not open with it), and the chunk's "Page N — X" locator names the new section.

Applied where the manual is read: the provider's `fetchOfficialPolicyManual`, the loop's `manualFor`, and the
full-manual loader. Search hits of the official manual are relabelled by chunk id from the same read
(`relabelManualRows`, cached per manual version); rows of any other document are untouched. read_policy's source card
names the section read. On production's 151 chunks this relabels 15, each a mid-chunk heading its own row records.

**Ask Bubbles: same bug.** Bubbles reads the same JBA manual (as Buff City Soap) through the same reader
(`official-policy-manual.ts`, its own provider and full-manual loader), and its stored rows lag the same way. Port the
mechanism — `withSectionsInForce`, `relabelManualRows`, the three call sites and the read_policy card — with Bubbles'
own content and its own fixture; never copy this app's manual text or its section names into Bubbles. This session has
read-only access to Ask Bubbles, so QA routes the port to a Bubbles coder.

**Tests:** `sections-in-force.test.ts` (production's rows: the disability chunks relabelled, the immigration control
kept, the next section's own start, a row of another document untouched, and the guardrails: no heading set, no heading
line, a stored section that moved on); replay `nov23-manual-section-in-force-cases.ts` ("what is the policy on
disability accommodation" with production's chunks 23–27 in place: the source card names Disability Accommodation;
control: an immigration question still cites Immigration Law Compliance). Both fail on main.

**QA's controls (23 Nov 2026), part of the port:** a chunk keeps its stored label for the text before its new heading.
Only a chunk whose new heading is in force from its first line is relabelled whole; otherwise `sectionAfter` records
where the new section starts, and a search hit is split there (`relabelManualRows`), with citations keyed by chunk and
locator. Controls: chunk 121's Time Records lines stay Time Records; chunk 67's Solicitation lines stay Solicitation and
Care and Cleaning is p.21.
