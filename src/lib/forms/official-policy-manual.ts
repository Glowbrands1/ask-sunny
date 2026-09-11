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
 *     "For corrective action please refer ALWAYS to this: [the policy manual]
 *      — [the section], page N (the page number can change depending on the
 *      violated policy)."
 *
 * So the manual is not searched for. It is PINNED BY IDENTITY, exactly as the
 * Performance Management Framework is, and the only remaining question is which
 * of its sections the ticked offense points at. That question is answered from
 * the manual's OWN TEXT: the section is found by its heading as the manual
 * spells it, and the page is the one that manual states for that heading.
 *
 * ============================================================================
 * WHICH MANUAL, AND HOW ITS SHEETS ARE LAID OUT
 * ============================================================================
 *
 * The manual is the JB & Associates Employment Policy Manual, revised May 2025,
 * which covers every brand the company operates and is the document a
 * Corrective Action Form is written against.
 *
 * A manual's layout is not universal, and this file reads two. One prints a
 * running title over a "- 12 -" rule over the section name; the JBA manual
 * prints a Word footer and then the section name. Both are read from the
 * document — see `PAGE_HEADING` and `sheetHeadingsOf` — and which numbering the
 * cited page comes from is a declared property of the manual rather than
 * something inferred per lookup. See `pagination`.
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

import { headingOf, isPageFooter } from "@/lib/ingestion/extract/pdf-sections";

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
  /**
   * ==========================================================================
   * WHICH NUMBERING THE CITED PAGE IS READ FROM
   * ==========================================================================
   *
   * A document states where its sections are in ONE numbering, and the two a
   * PDF carries differ. The JBA manual's dress code sits on the sheet a viewer
   * calls page 16, and that same sheet prints "15 | P a g e" in its footer
   * because the cover is unnumbered.
   *
   * Mixing them puts a one-off on an employment record — cite a section from
   * the contents page and another from the sheet it opens, and the same form
   * carries two numbering systems with nothing to say which is which. So the
   * numbering is a declared property of the manual, and it decides which parts
   * of the document may be read for a section:
   *
   *   `pdf_sheet`  The sheet number a PDF viewer shows, taken from the chunk's
   *                own `page` column. Sections are found by the heading printed
   *                on the sheet. The contents page is NOT read — it lists the
   *                manual's printed numbers, which are not these.
   *
   *   `printed`    The number the manual prints on its sheets and repeats in
   *                its contents page. Read from the document, never calculated
   *                from the other: an offset is a property of one export's
   *                front matter, not a rule.
   */
  readonly pagination: "pdf_sheet" | "printed";
}

/**
 * The approved manual a Corrective Action Form cites.
 *
 * THE FALLBACKS ARE MATCHED ON A PREFIX, not on the whole name, because the
 * version is in the title — "JBA Policy Manual Edited 5.2025" today and some
 * other date the next time it is re-issued. Pinning the exact string would mean
 * the citation silently stopped working on the day the manual was updated,
 * which is the day it matters most.
 *
 * IT CITES PDF SHEET NUMBERS, at the business's instruction. This manual is
 * read as the PDF everyone has a copy of, so "page 16" is the page a manager
 * types into a viewer and lands on.
 */
export const OFFICIAL_POLICY_MANUAL: PolicyManualIdentity = {
  id: "official_policy_manual",
  tag: "official-policy-manual",
  fallbackFilenames: ["JBA-Policy-Manual"],
  fallbackTitles: ["JBA Policy Manual"],
  pagination: "pdf_sheet",
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
  /**
   * The heading the extractor read off the sheet, when it kept one.
   *
   * Null on every chunk indexed before PDF extraction learned to recognise a
   * heading, which is why the content scan below exists alongside this.
   */
  readonly section?: string | null;
}

/** A section of the manual, named and paginated by the manual itself. */
export interface ManualSection {
  /** The heading as the manual spells it — never reworded. */
  readonly heading: string;
  /** The page the MANUAL prints, which is what a manager turns to. */
  readonly page: number;
  /** Which chunk answered, so a citation can be traced back to a row. */
  readonly chunkIndex: number;
  /**
   * Which part of the manual evidenced it.
   *
   * `page_heading`  the section opens a sheet, and its name and page sit on
   *                 two adjacent lines of that sheet.
   * `contents`      the section is introduced mid-sheet, and the manual's OWN
   *                 table of contents is what names it and gives its page.
   * `sheet_heading` the section's heading is printed on the sheet, and the page
   *                 is the PDF sheet that heading was extracted from.
   *
   * Recorded rather than flattened because the two are different strengths of
   * evidence and the provenance should say which one a citation rests on.
   */
  readonly foundBy: "page_heading" | "contents" | "sheet_heading";
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

/**
 * A chunk that is the manual's table of contents.
 *
 * IT IS BOTH THE HAZARD AND THE SECOND SOURCE OF TRUTH. It lists every heading
 * in the manual, so an unguarded search of the body for a section name matches
 * it first and every offense cites page 1 — which is why the page-heading tier
 * never looks at it. And it is the only place this document names the sections
 * that are introduced mid-sheet, which is why the second tier looks at nothing
 * else.
 */
function isTableOfContents(content: string): boolean {
  return /table of contents/i.test(content.slice(0, 400));
}

/**
 * ============================================================================
 * A MANUAL WHOSE SHEETS CARRY A HEADING AND NOTHING ELSE
 * ============================================================================
 *
 * The JBA manual does not print a running title and a "- 12 -" rule the way the
 * layout above does. Its sheets carry a Word footer and then the section's own
 * heading:
 *
 *     15 | P a g e                       <- the printed number, in the footer
 *     Dress Code for The Company         <- the section
 *     The Company Employees are to keep a neat, clean, professional ...
 *
 * So the heading is read the way INGESTION reads it — `headingOf` is the same
 * judgement the extractor applies, imported rather than restated so the two can
 * never drift — and the page is the PDF sheet the chunk came from, which the
 * `page` column already holds.
 *
 * ============================================================================
 * WHY THIS IS NOT THE SUBSTRING SEARCH THE FILE WARNS ABOUT
 * ============================================================================
 *
 * The hazard named above is real: "lack of punctuality or absenteeism has a
 * negative impact" would answer a search for the Absenteeism section, and the
 * contents page would answer a search for any heading at all. Neither can
 * happen here, and not by luck:
 *
 *   A LINE MUST PASS `headingOf`. Prose does not — a sentence ends in
 *   punctuation, a bullet starts with one, and body text in a manual runs past
 *   the length a heading has. The clause about absenteeism is a sentence and
 *   fails on all three.
 *
 *   THE CONTENTS PAGE CANNOT ANSWER. Its rows are dot leaders, which
 *   `headingOf` rejects outright. The page that lists every heading in the
 *   manual is therefore unreadable by this tier, which is exactly right.
 *
 *   THE MATCH IS EQUALITY, not containment, on the same loosened key the
 *   contents tier uses.
 *
 * ============================================================================
 * AND THE PAGE BELONGS TO THE HEADING
 * ============================================================================
 *
 * A chunk can span a page break, and its `page` column is where it STARTED. A
 * heading found after that break sits on the next sheet, so citing the chunk's
 * page would be off by one. The footer line is where a sheet begins, so the
 * scan stops at the first one it meets after the chunk's own — leaving only
 * headings the chunk's page actually covers.
 */
function sheetHeadingsOf(content: string): string[] {
  const headings: string[] = [];
  let started = false;

  for (const line of content.split("\n")) {
    if (isPageFooter(line)) {
      // The chunk's own sheet may open with its footer; a later one is the
      // next sheet, and nothing past it is on the page being cited.
      if (started) break;
      continue;
    }
    if (line.trim() === "") continue;
    started = true;

    const heading = headingOf(line);
    if (heading) headings.push(heading);
  }

  return headings;
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
 * ============================================================================
 * THE SECOND PLACE THE MANUAL SAYS WHERE A SECTION IS: ITS OWN CONTENTS PAGE
 * ============================================================================
 *
 * Not every section opens a sheet. Absenteeism, the Standards of Conduct and
 * both attendance sections are introduced part-way down one, and the extractor
 * did not preserve their headings as text at all — they exist in this document
 * in exactly one place, the table of contents:
 *
 *     ... Salaried Manager Attendance, Schedule Requirements 13
 *         Hourly Employee Attendance, Schedule Requirements 14
 *         Schedule Requests - Trading Shifts 15 Absenteeism 15 ...
 *
 * That IS the manual saying where its sections are, so reading it is reading
 * the document rather than inferring anything. The two tiers agree where both
 * apply — the contents page gives Dress for Success - Tanning Consultant as
 * page 12, and so does the heading printed on the sheet itself.
 *
 * ============================================================================
 * THE MATCH IS ANCHORED TO THE PAGE NUMBER, WHICH IS WHAT MAKES IT SAFE
 * ============================================================================
 *
 * A contents entry is its name followed immediately by its page. Requiring the
 * number means a PARTIAL name cannot resolve: "Attendance" is followed by
 * ", Schedule Requirements", not by a digit, so it matches nothing rather than
 * quietly returning the salaried manager's page for an hourly employee's
 * record. Verified against the real contents page — that exact query returns no
 * hits.
 *
 * AND AMBIGUITY IS REFUSED. A name that appears twice in the contents cannot
 * say which page it means, so it cites neither.
 */
function contentsPage(toc: string, name: string): number | null {
  const words = headingKey(name).split(" ").filter((word) => word !== "");
  if (words.length === 0) return null;

  const gap = "[^A-Za-z0-9]+";
  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])${words.map(escapeForRegExp).join(gap)}${gap}(\\d{1,3})(?![0-9])`,
    "gi",
  );

  const pages = [...toc.matchAll(pattern)].map((match) => Number(match[1]));
  if (pages.length !== 1) return null;

  const page = pages[0]!;
  return Number.isFinite(page) && page > 0 ? page : null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The manual's section for one of these headings, with its printed page.
 *
 * TWO TIERS, STRONGEST FIRST. A section that opens a sheet is matched on that
 * sheet's own heading line, where the name and the page sit two lines apart.
 * Everything else falls to the manual's table of contents.
 *
 * NEITHER TIER READS BODY PROSE, which is the property that keeps a citation
 * honest. A substring search over the manual answers "Absenteeism" from a
 * sentence in Schedule Requests and answers any heading at all from the
 * contents page, and both would put a confident citation of the wrong place on
 * an employment record.
 *
 * The heading that comes back is the manual's own spelling, because a citation
 * that tidies one up sends the reader looking for something the manual does not
 * say.
 */
export function findManualSection(
  chunks: readonly ManualChunk[],
  headings: readonly string[],
  pagination: PolicyManualIdentity["pagination"] = OFFICIAL_POLICY_MANUAL.pagination,
): ManualSection | null {
  const wanted = headings.map(headingKey).filter((key) => key !== "");
  if (wanted.length === 0) return null;

  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  /*
   * A MANUAL READ IN PDF SHEET NUMBERS IS READ FROM ITS SHEETS ONLY.
   *
   * The page comes from the chunk's `page` column, so the heading has to come
   * from the same sheet for the two halves of the citation to agree. The
   * contents page states the manual's PRINTED numbers, so it is not consulted
   * at all here — a section taken from it would be cited with a number from the
   * other numbering system, on the same form as one that was not.
   */
  if (pagination === "pdf_sheet") {
    for (const chunk of ordered) {
      if (chunk.page === null) continue;

      /*
       * THE EXTRACTED HEADING FIRST. `section` is what ingestion read off the
       * sheet, so when it is present there is nothing to re-derive. It is null
       * on chunks indexed before the extractor recognised headings, and the
       * content scan covers those without needing them re-indexed.
       */
      const candidates = chunk.section
        ? [chunk.section]
        : sheetHeadingsOf(chunk.content);

      const heading = candidates.find((candidate) =>
        wanted.some((key) => headingKey(candidate) === key),
      );
      if (!heading) continue;

      return {
        heading: heading.trim(),
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        foundBy: "sheet_heading",
      };
    }

    return null;
  }

  for (const chunk of ordered) {
    const opening = pageHeadingOf(chunk.content);
    if (!opening) continue;

    const key = headingKey(opening.heading);
    if (!wanted.some((heading) => key === heading)) continue;

    return {
      heading: opening.heading,
      page: opening.page,
      chunkIndex: chunk.chunkIndex,
      foundBy: "page_heading",
    };
  }

  const contents = ordered.filter((chunk) => isTableOfContents(chunk.content));
  if (contents.length === 0) return null;
  const toc = contents.map((chunk) => chunk.content).join(" ");

  for (const heading of headings) {
    const page = contentsPage(toc, heading);
    if (page === null) continue;

    return {
      heading: spellingIn(toc, [heading]) ?? heading,
      page,
      chunkIndex: contents[0]!.chunkIndex,
      foundBy: "contents",
    };
  }

  return null;
}

/**
 * The heading exactly as this manual prints it.
 *
 * Matching is loose so a re-issue that changes a hyphen still resolves; what is
 * PRINTED on the form must be the document's own wording, because a citation
 * that tidies up a heading sends the reader looking for something the manual
 * does not say.
 */
function spellingIn(content: string, headings: readonly string[]): string | null {
  for (const heading of headings) {
    const index = content.toLowerCase().indexOf(heading.toLowerCase());
    if (index >= 0) return content.slice(index, index + heading.length);
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
 * so a box is listed only where the business has said which section governs it
 * and the manual states that section under a name of its own. Every other box
 * resolves to nothing, the field stays empty, and the manager fills it — which
 * is what every Corrective Action Form did before any of this.
 *
 * ONE BOX CITES ONE SECTION. A form with several ticked cites each of them, in
 * the order they were ticked, and a form ticked only for dress code says
 * nothing about attendance.
 *
 * THE BOXES DELIBERATELY LEFT OUT, and why:
 *
 *   UNDER PERFORMANCE         has no policy section, and should not: §7 of the
 *                             approved framework is that underperformance
 *                             enters at coaching. A policy citation here would
 *                             assert that being below target breaches a rule,
 *                             which is the substitution the whole progression
 *                             exists to prevent.
 *
 *   VIOLATION OF COMPANY      names the whole manual rather than a section of
 *   POLICIES                  it. Which policy is the manager's to say, and
 *                             they say it by ticking the box that names one.
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
   * THE ONE THE BUSINESS SPELLED OUT. The JBA manual states the dress code once
   * for the whole company and then varies it by BRAND — Crunch Fitness, Buff
   * City Soap, Sun Tan City, the JBA office — rather than by role.
   *
   * THE COMPANY-WIDE SECTION IS WHAT IS CITED, and the brand sub-sections are
   * deliberately not. It is the section that states the rule a corrective
   * action rests on — a neat, clean, professional appearance, and being sent
   * home to change — and it governs everybody. A brand sub-section states what
   * a shirt may look like in one brand, under a heading ("Shirts", "Pants",
   * "Sun Tan City") that names no policy on its own and would read as a
   * citation of nothing on an employment record.
   */
  dress_code: {
    headings: ["Dress Code for The Company"],
  },
  /*
   * BOTH ATTENDANCE BOXES CITE THE ATTENDANCE SECTION, which is where this
   * manual puts both. It opens with the requirement to know your schedule and
   * always be on time, and closes on excessive absenteeism and the no-call
   * no-show — so a late consultant and an absent one are each cited the section
   * that actually governs them.
   *
   * NO ROLE SPLIT, because this manual has none: it states one attendance
   * policy for every employee. `managementHeadings` is left unset rather than
   * pointed at the same section, so the absence is visible as a fact about the
   * document rather than looking like a copy-paste.
   */
  tardiness: { headings: ["Attendance"] },
  absenteeism: { headings: ["Attendance"] },
  /*
   * NAMED AS THE MANUAL NAMES IT. "Standards of Conduct" heads the sheet
   * listing the infractions that may result in disciplinary action, and the
   * offense box carries the same words.
   */
  standards_of_conduct: {
    headings: ["Standards of Conduct"],
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
 * ONE MANUAL, EVERY SECTION THAT WAS TICKED. A form ticked for both dress code
 * and absenteeism breached two policies and cites both, joined the way the
 * retrieval-built reference joins several sections of one document:
 *
 * `... — Dress for Success - Tanning Consultant, page 12; Absenteeism, page 15`
 *
 * The title is the document's, each heading is the manual's own spelling and
 * each page is the one it prints. Nothing in this string was composed.
 */
export function officialManualReference(
  documentTitle: string,
  sections: readonly ManualSection[] | ManualSection,
): string {
  const list = Array.isArray(sections) ? sections : [sections as ManualSection];
  const cited = [
    ...new Set(list.map((section) => `${section.heading.trim()}, page ${section.page}`)),
  ];

  return `${documentTitle.trim()} — ${cited.join("; ")}`;
}

/**
 * Every section the ticked boxes point at, in the order they were ticked.
 *
 * Pure, so the selection is testable against the manual's real text without a
 * database — which is how the headings in `OFFENSE_MANUAL_SECTIONS` are kept
 * honest about what this particular manual actually contains.
 */
export function manualSectionsFor(input: {
  readonly chunks: readonly ManualChunk[];
  readonly offenseKeys: readonly string[];
  readonly jobTitle?: string | null;
}): ManualSection[] {
  const found: ManualSection[] = [];

  for (const headings of sectionHeadingsFor(input)) {
    const section = findManualSection(input.chunks, headings);
    // A box whose section this manual does not state cites nothing, and does
    // not stop the boxes beside it from citing theirs.
    if (!section) continue;
    if (found.some((seen) => seen.heading === section.heading)) continue;
    found.push(section);
  }

  return found;
}

/** The first section the ticked boxes point at, or none. */
export function manualSectionFor(input: {
  readonly chunks: readonly ManualChunk[];
  readonly offenseKeys: readonly string[];
  readonly jobTitle?: string | null;
}): ManualSection | null {
  return manualSectionsFor(input)[0] ?? null;
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
  readonly sections: readonly ManualSection[];
}): Record<string, unknown> {
  return {
    grounded: true,
    verified: true,
    source: "official_policy_manual",
    matchedBy: input.matchedBy,
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    /* Every section cited, each with the evidence that placed it. */
    sections: input.sections.map((section) => ({
      locator: section.heading,
      page: section.page,
      foundBy: section.foundBy,
      chunkIndex: section.chunkIndex,
    })),
  };
}
