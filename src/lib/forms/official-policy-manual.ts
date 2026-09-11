/**
 * ============================================================================
 * THE OFFICIAL POLICY MANUAL IS NAMED BY IDENTITY, NOT FOUND BY SIMILARITY
 * ============================================================================
 *
 * "Direct policy from official manual" came back blank on Corrective Action
 * Forms whose offense box was ticked in plain sight above it, and the reason
 * was not that the manual was missing. It is indexed, it is 105 chunks, and it
 * holds Dress for Success, Absenteeism and the Standards of Conduct.
 *
 * The reason was that the field was filled from a GENERAL SEMANTIC SEARCH over
 * every approved category, gated by the similarity floor the open-ended chat
 * path uses. A manager writing "she was wearing slippers today" is not writing
 * in the manual's vocabulary, so the one document the form needs did not clear
 * a bar tuned for a different job — and the form correctly reported that no
 * approved policy matched.
 *
 * THE BUSINESS SETTLED IT DIFFERENTLY, and their instruction is the design:
 *
 *     "For corrective action please refer ALWAYS to this: Driven to Shine
 *      Policy Manual 2.2025 — Dress for Success — Tanning Consultant, page 12
 *      (the page number can change depending on the violated policy)."
 *
 * So the manual is not searched for. It is PINNED BY IDENTITY, exactly as the
 * Performance Management Framework is, and the only remaining question is which
 * of its sections the ticked offense points at. That question is answered from
 * the manual's OWN TEXT: the section is found by its heading as the manual
 * spells it, and the page is the page the manual prints on that sheet.
 *
 * ============================================================================
 * WHAT THIS DOES NOT DO, WHICH IS THE HALF THAT MATTERS
 * ============================================================================
 *
 * IT NEVER COMPOSES A CITATION. Every part of the reference comes from the
 * database rows: the title from the document, the heading and the page from the
 * chunk's own content. There is no parameter here a caller could use to supply
 * a page number, and no table in this file that says what any policy REQUIRES.
 * A re-issued manual that moves Dress for Success to another page is followed
 * without an edit, because nothing here remembers where it used to be.
 *
 * IT FAILS CLOSED, PER OFFENSE. An offense box with no section mapped, or one
 * whose section this manual does not contain, produces NOTHING — the field
 * stays empty, the manager completes it, and finalizing still asks for the
 * acknowledgement. A blank line a manager can fill is the safe failure; a
 * confident citation of the wrong section of a real manual is the dangerous
 * one, because it looks checked.
 */

/* ------------------------------------------------------------- identity --- */

/**
 * The fields that say WHICH document is the official manual.
 *
 * Deliberately the same three the framework roles use — tag first, filename and
 * title only as a fallback — because the reasoning is identical and was written
 * out in `document-roles.ts`: a uuid binds the build to one database, a
 * category is not unique, and a filename breaks on a tidy-up. The tag is a
 * property of the document, curated by the people who own the corpus.
 */
export interface PolicyManualIdentity {
  readonly id: string;
  readonly tag: string;
  readonly fallbackFilenames: readonly string[];
  readonly fallbackTitles: readonly string[];
}

/**
 * The approved manual a Corrective Action Form cites.
 *
 * THE FALLBACKS ARE MATCHED ON A PREFIX, not on the whole name, because the
 * version is in the title — "Driven to Shine Policy Manual 2.2025" today and
 * some other number the next time it is re-issued. Pinning the exact string
 * would mean the citation silently stopped working on the day the manual was
 * updated, which is the day it matters most.
 */
export const OFFICIAL_POLICY_MANUAL: PolicyManualIdentity = {
  id: "official_policy_manual",
  tag: "official-policy-manual",
  fallbackFilenames: ["Driven-to-Shine-Policy-Manual"],
  fallbackTitles: ["Driven to Shine Policy Manual"],
};

/** The document columns an identity decision is made from. */
export interface ManualCandidateDocument {
  readonly id: string;
  readonly title: string;
  readonly original_filename: string;
  readonly tags: readonly string[] | null;
}

export type ManualResolution =
  | { readonly ok: true; readonly document: ManualCandidateDocument; readonly matchedBy: "tag" | "fallback" }
  | { readonly ok: false; readonly problem: "not_found" | "ambiguous" };

function normalize(value: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Which indexed document is the official manual.
 *
 * TAG FIRST, EXACTLY. A tag is a deliberate act by whoever owns the corpus, so
 * it wins outright and the fragile identifiers are never consulted once one
 * exists.
 *
 * THE FALLBACK MATCHES A PREFIX, which is the one way this differs from the
 * framework roles and it is not a relaxation for convenience. Their titles are
 * fixed; a policy manual carries its version in its name — "Driven to Shine
 * Policy Manual 2.2025" this year — so an exact match would stop citing the
 * manual on the day it was re-issued, which is the day a stale citation would
 * do the most harm.
 *
 * AMBIGUITY IS A FAILURE, NOT A TIE TO BREAK. Two candidates means somebody
 * uploaded a replacement without retiring the original, and the two will not
 * say the same thing — very possibly not on the same page. Picking by row order
 * would put whichever the database happened to return first on an employment
 * record, so this refuses and the field stays blank.
 */
export function resolvePolicyManual(
  documents: readonly ManualCandidateDocument[],
  identity: PolicyManualIdentity = OFFICIAL_POLICY_MANUAL,
): ManualResolution {
  const tag = normalize(identity.tag);
  const tagged = documents.filter((document) =>
    (document.tags ?? []).some((value) => normalize(value) === tag),
  );
  if (tagged.length === 1) return { ok: true, document: tagged[0]!, matchedBy: "tag" };
  if (tagged.length > 1) return { ok: false, problem: "ambiguous" };

  const prefixes = [
    ...identity.fallbackFilenames.map(normalize),
    ...identity.fallbackTitles.map(normalize),
  ].filter((prefix) => prefix !== "");

  const fallback = documents.filter((document) => {
    const filename = normalize(document.original_filename);
    const title = normalize(document.title);
    return prefixes.some((prefix) => filename.startsWith(prefix) || title.startsWith(prefix));
  });
  if (fallback.length === 1) return { ok: true, document: fallback[0]!, matchedBy: "fallback" };
  if (fallback.length > 1) return { ok: false, problem: "ambiguous" };

  return { ok: false, problem: "not_found" };
}

/* --------------------------------------------------------------- chunks --- */

/** A manual chunk, as the knowledge tables hold one. */
export interface ManualChunk {
  readonly chunkIndex: number;
  /** The page of the PDF the chunk was extracted from. */
  readonly page: number | null;
  readonly content: string;
}

/** A section of the manual, named and paginated by the manual itself. */
export interface ManualSection {
  /** The heading as the manual spells it — never reworded. */
  readonly heading: string;
  /** The page the MANUAL prints, which is what a manager turns to. */
  readonly page: number;
  /** Which chunk answered, so a citation can be traced back to a row. */
  readonly chunkIndex: number;
}

/**
 * ============================================================================
 * A SECTION IS A PAGE HEADING, AND NOTHING ELSE COUNTS
 * ============================================================================
 *
 * This manual's sheets begin in a fixed shape the extractor preserved:
 *
 *     Driven to Shine Policy Manual      <- the running title
 *     - 12 -                             <- the page THE MANUAL prints
 *     Dress for Success - Tanning Consultant   <- the section
 *     No dress code can cover all contingencies, ...
 *
 * Both halves of a citation come from those two adjacent lines, which is what
 * makes the citation checkable: the page is the number printed at the top of
 * the very sheet whose heading was matched. A manager can turn to it.
 *
 * ============================================================================
 * WHY NOT JUST SEARCH THE TEXT FOR THE HEADING
 * ============================================================================
 *
 * Because prose contains headings' words. "Lack of punctuality or absenteeism
 * has a negative impact on everyone's schedule" sits in the Schedule Requests
 * section and would answer a search for the Absenteeism section; the contents
 * page lists every heading in the manual and would answer a search for any of
 * them. Both would produce a confident citation of the wrong place in a real
 * manual, on somebody's employment record, and confident-and-wrong is the one
 * outcome worse than blank.
 *
 * SO ONLY A PAGE HEADING COUNTS. Sections the manual introduces mid-sheet —
 * Absenteeism, the Standards of Conduct, the two attendance sections — carry no
 * heading the extracted text marks as one, so they resolve to nothing and the
 * manager fills the line. That is a real limit and it is stated rather than
 * papered over: see `OFFENSE_MANUAL_SECTIONS`.
 *
 * THE PAGE IS THE MANUAL'S, NOT THE PDF'S. They differ by one throughout this
 * document — the PDF's sheet 13 prints "- 12 -" — and the business cites the
 * printed one. Read, never calculated: an offset of one is a property of this
 * export's front matter rather than a rule, and arithmetic would print a wrong
 * page the first time a manual was issued with a different cover.
 */
const PAGE_HEADING =
  /(?:^|\n)[ \t]*-[ \t]*(\d{1,3})[ \t]*-[ \t]*\n[ \t]*([^\n]{1,80}?)[ \t]*\n/;

/** How far into a chunk the running header may sit before it is body text. */
const HEADER_WINDOW = 200;

/**
 * The page and section a chunk opens a sheet with, if it opens one.
 *
 * Returns null for a chunk that continues a page — most of them — which is
 * what keeps body prose out of the citation.
 */
export function pageHeadingOf(content: string): { page: number; heading: string } | null {
  const match = PAGE_HEADING.exec(content.slice(0, HEADER_WINDOW));
  if (!match) return null;

  const page = Number(match[1]);
  const heading = (match[2] ?? "").trim();
  if (!Number.isFinite(page) || page <= 0 || heading === "") return null;

  return { page, heading };
}

/** Loosened for matching: case, punctuation and spacing drift are absorbed. */
function headingKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The manual's section for one of these headings, with its printed page.
 *
 * MATCHED ON THE HEADING LINE ALONE — never on the body — so a section is cited
 * only where the manual itself prints its name at the top of a sheet. The
 * heading that comes back is the manual's own spelling, because a citation that
 * tidies up a heading sends the reader looking for something the manual does
 * not say.
 */
export function findManualSection(
  chunks: readonly ManualChunk[],
  headings: readonly string[],
): ManualSection | null {
  const wanted = headings.map(headingKey).filter((key) => key !== "");
  if (wanted.length === 0) return null;

  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  for (const chunk of ordered) {
    const opening = pageHeadingOf(chunk.content);
    if (!opening) continue;

    const key = headingKey(opening.heading);
    if (!wanted.some((heading) => key === heading)) continue;

    return { heading: opening.heading, page: opening.page, chunkIndex: chunk.chunkIndex };
  }

  return null;
}

/* -------------------------------------------------------------- offense --- */

/**
 * Which section of the manual an offense box points at.
 *
 * ============================================================================
 * ONLY WHAT THE BUSINESS HAS SETTLED, AND THE REST STAYS BLANK
 * ============================================================================
 *
 * Each entry here decides the citation printed on somebody's employment record,
 * so this map holds only the boxes whose section the business has named or
 * whose heading the manual states unambiguously. Every other box resolves to
 * nothing, the field stays empty, and the manager fills it — which is exactly
 * the behaviour every Corrective Action Form has today.
 *
 * THE BOXES DELIBERATELY LEFT OUT, and why:
 *
 *   TARDINESS/LEAVING EARLY   the manual carries two attendance sections,
 *                             salaried and hourly, and introduces both mid-
 *                             sheet, so neither is a page heading this can
 *                             match. Guessing between them would cite a
 *                             manager's policy on a consultant's record.
 *
 *   ABSENTEEISM               has a section, introduced mid-sheet. The only
 *                             other place the word appears as text is a
 *                             sentence in Schedule Requests, which is exactly
 *                             the wrong-place-confidently failure a loose match
 *                             would produce.
 *
 *   STANDARDS OF CONDUCT      same shape: a real section, introduced mid-sheet,
 *                             with the phrase also appearing in the paragraph
 *                             before it.
 *
 *   UNDER PERFORMANCE         has no policy section, and should not: §7 of the
 *                             approved framework is that underperformance
 *                             enters at coaching. A policy citation here would
 *                             assert that being below target breaches a rule.
 *
 *   VIOLATION OF COMPANY      names the whole manual rather than a section of
 *   POLICIES                  it. Which policy is the manager's to say.
 *
 *   OTHER                     is a write-in. There is nothing to look up.
 */
export interface OffenseSections {
  /** The section for a front-line employee. The default. */
  readonly headings: readonly string[];
  /** The section for store management, where the manual has a separate one. */
  readonly managementHeadings?: readonly string[];
}

export const OFFENSE_MANUAL_SECTIONS: Readonly<Record<string, OffenseSections>> = {
  /*
   * THE ONE THE BUSINESS SPELLED OUT, and the one this manual prints as a page
   * heading. Their example names the Tanning Consultant section, which is the
   * front-line default; the manual carries a separate Store Management section
   * and a Salon Director's record cites that one.
   */
  dress_code: {
    headings: ["Dress for Success - Tanning Consultant"],
    managementHeadings: ["Dress for Success - Store Management"],
  },
};

/**
 * Whether this job title is store management.
 *
 * Only consulted where the manual splits a section in two. Unknown is treated
 * as front-line, because that is both the commoner case and the safer one: the
 * consultant section is the one that governs everybody who is not management.
 */
const MANAGEMENT_TITLE =
  /\b(?:sd|asd|dm|sdit|tsd|dmit|salon director|assistant salon director|district manager|regional manager|store manager|manager)\b/i;

export function isManagementTitle(jobTitle: string | null | undefined): boolean {
  const title = (jobTitle ?? "").trim();
  if (title === "") return false;
  // "Manager in training" is not management for the purposes of the manual's
  // own split, and neither is a tanning consultant whose title mentions one.
  if (/\bmanager in training\b/i.test(title)) return false;
  if (/\b(?:tc|fttc|tanning consultant)\b/i.test(title)) return false;
  return MANAGEMENT_TITLE.test(title);
}

/**
 * The headings to look for, given what was ticked and who this is about.
 *
 * SEVERAL TICKS RESOLVE IN THE FORM'S OWN ORDER, and only the first that the
 * manual actually answers is cited. A reference field holds one reference; a
 * list of three sections in a line that asks for a policy is a bibliography,
 * and the Policy Violated line above already names every category ticked.
 */
export function sectionHeadingsFor(input: {
  readonly offenseKeys: readonly string[];
  readonly jobTitle?: string | null;
}): string[][] {
  const management = isManagementTitle(input.jobTitle);

  return input.offenseKeys
    .map((key) => OFFENSE_MANUAL_SECTIONS[key])
    .filter((entry): entry is OffenseSections => entry !== undefined)
    .map((entry) =>
      management && entry.managementHeadings
        ? [...entry.managementHeadings]
        : [...entry.headings],
    );
}

/* ------------------------------------------------------------ reference --- */

/**
 * The line the form prints.
 *
 * `Driven to Shine Policy Manual 2.2025 — Dress for Success - Tanning
 *  Consultant, page 12`
 *
 * The title is the document's, the heading is the manual's own spelling and the
 * page is the one it prints. Nothing in this string was composed.
 */
export function officialManualReference(
  documentTitle: string,
  section: ManualSection,
): string {
  return `${documentTitle.trim()} — ${section.heading.trim()}, page ${section.page}`;
}

/**
 * The whole lookup, over chunks a caller has already fetched.
 *
 * Pure, so the selection is testable against the manual's real text without a
 * database — which is how the headings in `OFFENSE_MANUAL_SECTIONS` are kept
 * honest about what this particular manual contains.
 */
export function manualSectionFor(input: {
  readonly chunks: readonly ManualChunk[];
  readonly offenseKeys: readonly string[];
  readonly jobTitle?: string | null;
}): ManualSection | null {
  for (const headings of sectionHeadingsFor(input)) {
    const section = findManualSection(input.chunks, headings);
    if (section) return section;
  }
  return null;
}

/**
 * The provenance a citation from the pinned manual carries.
 *
 * `grounded: true` and `verified: true` because an approved manual really did
 * answer — by identity rather than by similarity, which is what `matchedBy`
 * records. The document id, its title, the section and the page are all copied
 * from the rows that answered, so "where did this citation come from" has an
 * answer months later that points at a row somebody can open.
 *
 * The write-time guard reads `verified`, and the form card and the finalize
 * dialog read it too — so a form whose manual section resolved no longer asks
 * for an acknowledgement it does not need, and one whose section did not
 * resolve still does.
 */
export function officialManualProvenance(input: {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly matchedBy: "tag" | "fallback";
  readonly section: ManualSection;
}): Record<string, unknown> {
  return {
    grounded: true,
    verified: true,
    source: "official_policy_manual",
    matchedBy: input.matchedBy,
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    locator: input.section.heading,
    page: input.section.page,
    chunkIndex: input.section.chunkIndex,
  };
}
