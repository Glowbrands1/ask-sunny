import { headingKey, manualDisplayTitle } from "@/lib/forms/official-policy-manual";
import { manualEditionYear } from "@/lib/knowledge/current-manual-scope";
import { isPolicyTypeQuestion } from "@/lib/knowledge/hybrid-rank";
import { headingOf, isPageFooter, printedPageOf } from "@/lib/ingestion/extract/pdf-sections";
import type { KnowledgeCategory, SourceCitation } from "@/types";

/**
 * The whole current JBA Policy Manual, for a policy question.
 *
 * Ask Sunny is Sun Tan City only. The manual is shared across brands, so the
 * block keeps shared policy and Sun Tan City sections and leaves out Buff
 * City Soap, Crunch, and the JBA office. Chunk retrieval stays the answer
 * path until FULL_MANUAL_CONTEXT_ENABLED is on. This module does not read
 * the database.
 */

/** Chars / 4, the same estimate the prompt-cache helper uses. */
export const FULL_MANUAL_TOKEN_BUDGET = 120_000;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export interface FullManualChunk {
  readonly chunkIndex: number;
  readonly page: number | null;
  /**
   * The page number the sheet prints, when ingestion stored one.
   *
   * `page` is the PDF sheet. This manual's numbered sheets print one less
   * than that (sheet 20 prints 19). The cover has no printed number.
   */
  readonly printedPage?: number | null;
  readonly section: string | null;
  readonly content: string;
  /**
   * The printed page ingestion recorded for each heading in this chunk
   * (`metadata.sections`). A chunk can cross a sheet: chunk 46 starts with
   * Hair on 15 and continues with Facial Hair and Make-up on 16.
   */
  readonly sections?: readonly { readonly heading: string; readonly page: number }[];
}

export interface FullManualDocument {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly chunks: readonly FullManualChunk[];
}

export interface ManualPage {
  readonly page: number;
  readonly headings: readonly string[];
  readonly text: string;
}

/** One section's text on one printed page, for matching an answer sentence to its page. */
export interface ManualPassage {
  readonly page: number;
  readonly heading: string | null;
  readonly text: string;
}

export interface AssembledManual {
  readonly id: string;
  readonly title: string;
  readonly displayTitle: string;
  readonly category: string;
  readonly text: string;
  readonly tokens: number;
  readonly pages: readonly ManualPage[];
  readonly passages: readonly ManualPassage[];
}

export type FullManualAssembly =
  | {
      readonly ok: true;
      readonly manuals: readonly AssembledManual[];
      readonly block: string;
      readonly tokens: number;
    }
  | { readonly ok: false; readonly reason: "missing" | "over_budget" };

const FORM_COMMAND = /\b(?:create|draft|file|start|write(?:\s+\w+){0,3}\s+up)\b/i;
const ASKS_WHAT_POLICY_SAYS = /\b(?:what|which|does the|policy say|how many)\b/i;
const OTHER_MANUAL = /\b(?:dm manuals?|training manuals?|safety binders?|coaching guides?)\b/i;
const HR_POLICY =
  /\b(?:polic(?:y|ies)|handbook|human resources|\bhr\b|pto\b|time[\s-]*off|dress code|attendance|tard(?:y|iness)|cell phones?|w-?2|direct deposit|sick days?|vacation|payroll|standards of conduct|breaks?)\b/i;
const POLICY_MANUAL_TITLE = /\bpolicy manual\b/i;
const JBA_MANUAL_TITLE = /\bjba policy manual\b/i;
/** A contents row. Those lines name every brand; they are not the rule. */
const CONTENTS_LEADER = /\.{4,}/;
/**
 * Brand sections inside the shared manual. A heading that also names Sun Tan
 * City stays, because that rule applies here ("STC & Crunch" client tanning).
 */
const EXCLUDED_BRAND =
  /\b(?:buff city(?:\s+soap)?|crunch(?:\s+fitness)?|jba office|jb\s*&\s*associates office)\b/i;
const SUN_TAN_CITY = /\b(?:sun tan city|\bstc\b)\b/i;
const SHARED_SCOPE = /\b(?:all locations|for the company|company-wide|company wide)\b/i;
/** Dress-code lines that sit under a brand heading and do not name the brand. */
const APPEARANCE_SECTION =
  /^(?:shirts?|pants|shoes|belts?|hair|facial hair|make-?up|jewelry(?:\/accessories)?|accessories|tattoos?|nails|piercings?|name ?tags?|uniforms?|skirts?|shorts|outerwear|fragrances?|grooming|appearance|hats?|socks|leggings|hoodies?|jackets?|aprons?|polos?|visors?|sleeves?|collars?|undershirts?|swimwear|robes?|towels?|tights?|tanks?|nametags?)$/i;
/** A new policy section. Appearance lines under a brand heading are not these. */
const MAJOR_SECTION =
  /\b(?:polic(?:y|ies)|attendance|leave|parking|benefit|payroll|safety|conduct|discount|harassment|vacation|insurance|military|jury|maternity|hipaa|cobra|\bpto\b|timekeeping|e-?mail|password|confidential|social media|drug|alcohol|smoking|equal employment|open door|disciplinary|tanning|consent|minors?|wages?|reimbursement|verification|relatives?|equipment|vendors?|robber(?:y|ies)?|theft|visitors?|animals?|emergency|information technology|nondisclosure|weapons?|breaks?|meals?|overtime|schedules?|openings?|closings?|\bfound\b|core values)\b/i;

/**
 * A policy or HR question, not a form command and not a different manual.
 *
 * `heardIntent` is the trace intent before the card suffix (`policy`, not
 * `policy|no_card`). A DM manual or a safety binder stays on retrieval.
 */
export function isPolicyAnswerQuestion(question: string, heardIntent: string | null): boolean {
  const text = question.trim();
  if (!text) return false;
  if (heardIntent === "form" || heardIntent === "form_command") return false;
  if (FORM_COMMAND.test(text) && !ASKS_WHAT_POLICY_SAYS.test(text)) return false;
  if (OTHER_MANUAL.test(text) && !HR_POLICY.test(text)) return false;
  if (heardIntent === "policy" || heardIntent === "policy_question") return true;
  if (HR_POLICY.test(text)) return true;
  return isPolicyTypeQuestion(text);
}

export function isPolicyManualTitle(title: string): boolean {
  return POLICY_MANUAL_TITLE.test(title);
}

export function isJbaPolicyManualTitle(title: string): boolean {
  return JBA_MANUAL_TITLE.test(title);
}

export const FULL_MANUAL_GROUNDING_NOTE = `COMPANY KNOWLEDGE

The JBA Policy Manual for Sun Tan City is in the system prompt: shared policy and Sun Tan City sections, with [p.n] markers and section headings. End each policy statement with that [p.n] marker. Cite it as "<section name>, <manual title> p.<n> [p.n]". Do not use an [S#] marker. Do not cite a DM manual, a Salon Director manual, Buff City Soap, or Crunch.`;

function instructionHeader(): string {
  return [
    "FULL POLICY MANUAL",
    "This is the JBA Policy Manual as it applies to Sun Tan City: the shared policy and the Sun Tan City sections. Answer Sun Tan City policy questions from this text.",
    'Cite each policy in this exact shape: "<section name>, <manual title> p.<n> [p.n]".',
    "The section name is a heading printed below. The page is the [p.n] marker on that same text. The manual title is the cite-as name under that manual.",
    "Do not invent a section or a page. Do not use an [S#] marker. Do not cite a manager manual or a section written for another brand.",
  ].join("\n");
}

function blockFor(manuals: readonly AssembledManual[]): string {
  return [instructionHeader(), "", ...manuals.map((manual) => manual.text)].join("\n\n");
}

function pageOf(page: number | null | undefined): number | null {
  if (typeof page !== "number" || !Number.isInteger(page) || page <= 0) return null;
  return page;
}

/**
 * PDF sheets 3–6 are the table of contents. The first chunk is labelled
 * "Table of Contents"; the following chunks on those sheets have a null
 * section and dot leaders. Reference List starts on sheet 7 and prints 6.
 */
const CONTENTS_PDF_FIRST = 3;
const CONTENTS_PDF_LAST = 6;
/** Shortest repeated tail the chunker can carry into the next chunk. */
const OVERLAP_MIN_CHARS = 24;
/** One long sentence can exceed the 48-token overlap budget. */
const OVERLAP_WINDOW_CHARS = 4_000;

function isContentsHeading(section: string | null): boolean {
  return headingKey(section ?? "") === "table of contents";
}

function footerPage(content: string): number | null {
  for (const line of content.split("\n")) {
    const printed = printedPageOf(line);
    if (printed !== null) return printed;
  }
  return null;
}

function withoutPageFurniture(content: string): string {
  return content
    .split("\n")
    .filter((line) => !isPageFooter(line))
    .join("\n");
}

/**
 * Printed page for each PDF sheet.
 *
 * The footer (`41 | P a g e`) is the page a reader can check. It wins over
 * `metadata.printedPage` when that field still holds the PDF sheet (sheet
 * 42 prints 41). A sheet with neither keeps its PDF page, so the cover is
 * not shifted. The footer often sits on a different chunk than the section.
 */
function printedPageByPdfSheet(chunks: readonly FullManualChunk[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const chunk of chunks) {
    const pdf = pageOf(chunk.page);
    if (pdf === null || map.has(pdf)) continue;
    const printed = footerPage(chunk.content);
    if (printed !== null) map.set(pdf, printed);
  }
  for (const chunk of chunks) {
    const pdf = pageOf(chunk.page);
    if (pdf === null || map.has(pdf)) continue;
    const printed = pageOf(chunk.printedPage);
    if (printed !== null) map.set(pdf, printed);
  }
  return map;
}

function citedPageFor(chunk: FullManualChunk, bySheet: Map<number, number>): number | null {
  const pdf = pageOf(chunk.page);
  if (pdf !== null) {
    const printed = bySheet.get(pdf);
    if (printed !== undefined) return printed;
  }
  return footerPage(chunk.content) ?? pageOf(chunk.printedPage) ?? pdf;
}

/** Drop contents sheets so a heading in the contents cannot be cited. */
function omitContentsChunks(chunks: readonly FullManualChunk[]): FullManualChunk[] {
  let inside = false;
  const kept: FullManualChunk[] = [];
  for (const chunk of chunks) {
    const section = (chunk.section ?? "").trim();
    if (isContentsHeading(section)) {
      inside = true;
      continue;
    }
    if (section) inside = false;
    const pdf = pageOf(chunk.page);
    const onContentsSheet = pdf !== null && pdf >= CONTENTS_PDF_FIRST && pdf <= CONTENTS_PDF_LAST;
    const untitled = section.length === 0;
    if (onContentsSheet && untitled && (inside || CONTENTS_LEADER.test(chunk.content))) continue;
    kept.push(chunk);
  }
  return kept;
}

function prefixFunction(text: string): number[] {
  const pi = new Array<number>(text.length).fill(0);
  let length = 0;
  for (let index = 1; index < text.length; index += 1) {
    while (length > 0 && text[index] !== text[length]) length = pi[length - 1] ?? 0;
    if (text[index] === text[length]) length += 1;
    pi[index] = length;
  }
  return pi;
}

/**
 * How many leading characters of `next` repeat a suffix of `previous`.
 *
 * Ingest prepends the previous piece's trailing sentences (`previous\n\n`
 * plus the new piece) and does not cross a page. The longest match is that
 * carried tail. A shorter accident stays put.
 */
function overlapLength(previous: string, next: string): number {
  const haystack = previous.slice(-OVERLAP_WINDOW_CHARS);
  const needle = next.slice(0, Math.min(next.length, OVERLAP_WINDOW_CHARS));
  if (needle.length < OVERLAP_MIN_CHARS || haystack.length < OVERLAP_MIN_CHARS) return 0;
  const pi = prefixFunction(needle);
  let length = 0;
  for (let index = 0; index < haystack.length; index += 1) {
    while (length > 0 && haystack[index] !== needle[length]) length = pi[length - 1] ?? 0;
    if (haystack[index] === needle[length]) length += 1;
    if (length === needle.length && index < haystack.length - 1) length = pi[length - 1] ?? 0;
  }
  return length >= OVERLAP_MIN_CHARS ? length : 0;
}

function withoutLeadingOverlap(previous: string, next: string): string {
  const cut = overlapLength(previous.trimEnd(), next);
  if (cut === 0) return next.trim();
  return next.slice(cut).replace(/^\s+/, "");
}

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text);
}

/** A chunk boundary is not a sentence boundary. Join a wrapped line with a space. */
function joinSectionText(previous: string, next: string): string {
  const left = previous.replace(/\s+$/, "");
  const right = next.replace(/^\s+/, "");
  if (!left) return right;
  if (!right) return left;
  if (!endsSentence(left) && /^[a-z]/.test(right)) return `${left} ${right}`;
  return `${left}\n\n${right}`;
}

/**
 * Contents out, printed page chosen, overlap removed. Chunk order is unchanged.
 * `printedPage` on the result is the page a citation may use.
 */
function prepareManualChunks(chunks: readonly FullManualChunk[]): FullManualChunk[] {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const bySheet = printedPageByPdfSheet(ordered);
  const stripped: FullManualChunk[] = [];
  let previous = "";
  for (const chunk of omitContentsChunks(ordered)) {
    const content = withoutLeadingOverlap(previous, withoutPageFurniture(chunk.content));
    const section = (chunk.section ?? "").trim();
    const prior = (stripped[stripped.length - 1]?.section ?? "").trim();
    if (!content.trim() && (!section || headingKey(section) === headingKey(prior))) continue;
    stripped.push({ ...chunk, printedPage: citedPageFor(chunk, bySheet), content });
    if (content.trim()) previous = content;
  }
  return stripped;
}

type BrandScope = "shared" | "stc" | "excluded";

function namesSunTanCity(text: string): boolean {
  return SUN_TAN_CITY.test(text);
}

/** Buff City Soap, Crunch, or the JBA office — and not a Sun Tan City rule. */
function namesExcludedBrand(text: string): boolean {
  return EXCLUDED_BRAND.test(text) && !namesSunTanCity(text);
}

/**
 * A short appearance heading continues the brand section it sits under.
 * Company dress code comes first, while the scope is still shared, so those
 * same words stay. A later Attendance or Employee Parking heading does not.
 */
function continuesBrandSection(heading: string): boolean {
  if (MAJOR_SECTION.test(heading)) return false;
  return APPEARANCE_SECTION.test(heading.trim());
}

function scopeForHeading(heading: string, current: BrandScope): BrandScope {
  if (namesSunTanCity(heading)) return "stc";
  if (namesExcludedBrand(heading)) return "excluded";
  if (SHARED_SCOPE.test(heading)) return "shared";
  if (current !== "shared" && continuesBrandSection(heading)) return current;
  return "shared";
}

/**
 * The printed page ingestion recorded for a heading in this chunk. A page
 * before the chunk's own printed page is not used: a chunk's text does not
 * move back a sheet.
 */
function recordedHeadingPage(chunk: FullManualChunk, heading: string): number | null {
  const key = headingKey(heading);
  const floor = pageOf(chunk.printedPage);
  for (const entry of chunk.sections ?? []) {
    if (headingKey(entry.heading) !== key) continue;
    const page = pageOf(entry.page);
    if (page !== null && (floor === null || page >= floor)) return page;
  }
  return null;
}

/**
 * Shared JBA text and Sun Tan City sections, in chunk order.
 *
 * A brand heading applies until the next shared section or the other brand.
 * "Shirts" under Buff City Soap goes out with it. "Shirts" under Sun Tan City
 * stays. A contents line that only points at another brand is removed, and
 * the lines around it stay.
 */
export function sunTanCityChunks(chunks: readonly FullManualChunk[]): FullManualChunk[] {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  let carry: BrandScope = "shared";
  const kept: FullManualChunk[] = [];
  let piece = 0;

  for (const chunk of ordered) {
    const section = (chunk.section ?? "").trim();
    if (section) carry = scopeForHeading(section, carry);
    let active: BrandScope = carry;
    let piecePage = chunk.printedPage;
    let blockSection: string | null = active === "excluded" ? null : section || null;
    let lines: string[] = [];

    const flush = () => {
      const content = lines.join("\n").trim();
      if (active === "excluded" || !content) return;
      kept.push({
        chunkIndex: chunk.chunkIndex + piece * 1e-6,
        page: chunk.page,
        printedPage: piecePage,
        section: blockSection,
        content,
      });
      piece += 1;
    };

    for (const line of chunk.content.split("\n")) {
      if (CONTENTS_LEADER.test(line) && namesExcludedBrand(line)) continue;
      const heading = headingOf(line);
      if (heading) {
        const next = scopeForHeading(heading, active);
        const same =
          blockSection !== null && headingKey(heading) === headingKey(blockSection) && next === active;
        if (!same) {
          flush();
          lines = [];
          piecePage = recordedHeadingPage(chunk, heading) ?? piecePage;
          active = next;
          blockSection = next === "excluded" ? null : heading;
          if (next !== "excluded") lines.push(line);
          continue;
        }
      }
      if (active !== "excluded") lines.push(line);
    }
    flush();
    carry = active;
  }
  return kept;
}

/**
 * Chunks in chunk_index order. [p.n] is the printed page (the PDF sheet when
 * the sheet has no footer). The table of contents is already gone, and a
 * chunk's leading overlap is not repeated.
 */
export function assembleManual(doc: FullManualDocument): AssembledManual {
  const chunks = sunTanCityChunks(prepareManualChunks(doc.chunks));
  const pageMap = new Map<number, { headings: string[]; texts: string[] }>();
  const displayTitle = manualDisplayTitle(doc.title);
  const parts: string[] = [`# ${doc.title}`, `Cite as: ${displayTitle}`];
  let lastPage: number | null = null;
  let lastSection = "";
  let body = "";
  const passages: { page: number; heading: string | null; lines: string[] }[] = [];

  const flushBody = () => {
    if (!body.trim()) return;
    parts.push(body.trim());
    body = "";
  };

  for (const chunk of chunks) {
    const page = pageOf(chunk.printedPage);
    const section = (chunk.section ?? "").trim();
    const pageChanged = page !== lastPage;
    const sectionChanged = section.length > 0 && headingKey(section) !== headingKey(lastSection);
    if (pageChanged || sectionChanged) flushBody();
    if (page !== null && pageChanged) {
      parts.push(`[p.${page}]`);
      lastPage = page;
    }
    if (sectionChanged) {
      parts.push(`## ${section}`);
      lastSection = section;
    }
    const next = chunk.content.trim();
    if (next) body = joinSectionText(body, next);
    if (page === null) continue;
    const passageHeading = lastSection || null;
    const open = passages[passages.length - 1];
    if (open && open.page === page && headingKey(open.heading ?? "") === headingKey(passageHeading ?? "")) {
      if (next) open.lines.push(next);
    } else if (next || passageHeading) {
      passages.push({ page, heading: passageHeading, lines: next ? [next] : [] });
    }
    const entry = pageMap.get(page) ?? { headings: [], texts: [] };
    if (section && !entry.headings.some((heading) => headingKey(heading) === headingKey(section))) {
      entry.headings.push(section);
    }
    if (section) entry.texts.push(section);
    if (next) entry.texts.push(next);
    pageMap.set(page, entry);
  }
  flushBody();

  const pages = [...pageMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, entry]) => ({
      page,
      headings: entry.headings,
      text: entry.texts.join("\n"),
    }));
  const text = parts.join("\n\n");
  return {
    id: doc.id,
    title: doc.title,
    displayTitle,
    category: doc.category,
    text,
    tokens: estimateTokens(text),
    pages,
    passages: passages.map((item) => ({ page: item.page, heading: item.heading, text: item.lines.join("\n") })),
  };
}

function editionKey(title: string): string {
  if (isJbaPolicyManualTitle(title)) return "jba";
  return manualDisplayTitle(title).toLowerCase();
}

function newestEdition(docs: readonly FullManualDocument[]): FullManualDocument {
  return [...docs].sort((a, b) => {
    const year = (manualEditionYear(b.title) ?? 0) - (manualEditionYear(a.title) ?? 0);
    if (year !== 0) return year;
    return b.chunks.length - a.chunks.length || a.title.localeCompare(b.title);
  })[0]!;
}

function currentPolicyManuals(documents: readonly FullManualDocument[]): FullManualDocument[] {
  const groups = new Map<string, FullManualDocument[]>();
  for (const doc of documents) {
    if (!isPolicyManualTitle(doc.title) || doc.chunks.length === 0) continue;
    const key = editionKey(doc.title);
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }
  return [...groups.values()].map(newestEdition);
}

/**
 * Every policy question uses the current JBA Policy Manual, cut down to
 * shared policy and Sun Tan City sections. Another brand's policy manual
 * is not added. A training manual is not a policy manual. The question is
 * accepted so callers can pass the turn through unchanged; brand selection
 * does not depend on it.
 */
export function choosePolicyManuals(
  _question: string,
  documents: readonly FullManualDocument[],
  options?: { readonly budgetTokens?: number },
): FullManualAssembly {
  const budget = options?.budgetTokens ?? FULL_MANUAL_TOKEN_BUDGET;
  const jba = currentPolicyManuals(documents).filter((doc) => isJbaPolicyManualTitle(doc.title));
  const doc = jba[0];
  if (!doc) return { ok: false, reason: "missing" };

  const assembled = assembleManual(doc);
  if (!assembled.text.includes("## ") && !/\[p\.\d+\]/.test(assembled.text)) {
    return { ok: false, reason: "missing" };
  }
  if (estimateTokens(blockFor([assembled])) > budget) return { ok: false, reason: "over_budget" };
  const block = blockFor([assembled]);
  return { ok: true, manuals: [assembled], block, tokens: estimateTokens(block) };
}

export function needsRetrievalFallback(assembly: FullManualAssembly): boolean {
  return !assembly.ok;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidy(text: string): string {
  return text
    .replace(/\b(?:see|also)\s+(?=[.,;:]|$)/gi, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanHeading(raw: string): string {
  const tail = raw.split(/[.!?]\s+/).pop() ?? raw;
  return tail.replace(/^(?:see|also|and|the|per|under|in)\s+/i, "").trim();
}

/**
 * The sentence plus the source label.
 *
 * The label is the manual's own heading (Tattoos, Shoes, Eligibility). That
 * heading is written at the end of the capture and nowhere earlier is cut:
 * "Director. (Eligibility" keeps "Director. (", and "DirEligibility" keeps
 * "Dir". A shorter name that expands ("Dress Code") is replaced only at the
 * end, so the sentence in front of it stays.
 */
function citationLine(headingRaw: string, name: string, title: string, page: number): string {
  const label = `${name}, ${title} p.${page} [p.${page}]`;
  const atEnd = new RegExp(`${escapeRegExp(name)}\\s*$`, "i").exec(headingRaw);
  if (atEnd?.index !== undefined) return `${headingRaw.slice(0, atEnd.index)}${label}`;
  const quote = cleanHeading(headingRaw);
  const quoted = quote ? new RegExp(`${escapeRegExp(quote)}\\s*$`, "i").exec(headingRaw) : null;
  const quotedKey = headingKey(quote);
  const nameKey = headingKey(name);
  if (
    quoted?.index !== undefined &&
    quotedKey.length > 0 &&
    (quoted.index > 0 || nameKey.startsWith(quotedKey))
  ) {
    return `${headingRaw.slice(0, quoted.index)}${label}`;
  }
  const sentence = headingRaw.trim();
  return sentence ? `${sentence} ${label}` : label;
}

function aligns(quote: string, sheet: string): boolean {
  if (!quote || !sheet) return false;
  if (quote === sheet) return true;
  if (sheet.length >= 4 && quote.endsWith(sheet)) return true;
  if (quote.length >= 4 && (sheet.startsWith(quote) || sheet.endsWith(quote))) return true;
  return false;
}

function knownHeadings(manual: AssembledManual): string[] {
  const seen = new Set<string>();
  const headings: string[] = [];
  for (const page of manual.pages) {
    for (const heading of page.headings) {
      const key = headingKey(heading);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      headings.push(heading);
    }
  }
  return headings;
}

/** The manual's own heading, when the quote ends with it or is that heading. */
function headingFromQuote(manual: AssembledManual, raw: string): string | null {
  const quote = headingKey(cleanHeading(raw));
  if (quote.length < 3) return null;
  const ranked = knownHeadings(manual)
    .map((heading) => ({ heading, key: headingKey(heading) }))
    .filter((item) => aligns(quote, item.key))
    .sort((a, b) => b.key.length - a.key.length);
  if (ranked[0]) return ranked[0].heading;
  if (manual.pages.some((page) => headingKey(page.text).includes(quote))) return cleanHeading(raw);
  return null;
}

function headingListed(entry: ManualPage, heading: string): boolean {
  const key = headingKey(heading);
  if (!key) return false;
  return entry.headings.some((item) => {
    const listed = headingKey(item);
    return listed === key || aligns(key, listed) || aligns(listed, key);
  });
}

/**
 * The heading's own page.
 *
 * A section list wins. Body text is used only when no page lists the heading,
 * so the word "pants" inside the Belts rule is not the Pants section.
 */
function headingOnPage(manual: AssembledManual, heading: string, page: number): boolean {
  const entry = manual.pages.find((item) => item.page === page);
  if (!entry) return false;
  if (headingListed(entry, heading)) return true;
  if (manual.pages.some((item) => headingListed(item, heading))) return false;
  const key = headingKey(heading);
  return key.length > 0 && headingKey(entry.text).includes(key);
}

function pagesForHeading(manual: AssembledManual, heading: string): number[] {
  return manual.pages.filter((entry) => headingOnPage(manual, heading, entry.page)).map((entry) => entry.page);
}

function manualForTitle(manuals: readonly AssembledManual[], title: string): AssembledManual | undefined {
  const key = title.trim().toLowerCase();
  return manuals.find((manual) => manual.title.toLowerCase() === key || manual.displayTitle.toLowerCase() === key);
}

const KNOWLEDGE_CATEGORIES = new Set<KnowledgeCategory>([
  "leadership_coaching",
  "policies_compliance",
  "operations",
  "equipment_procedures",
  "training",
  "sales_client_experience",
  "bonuses_compensation",
  "safety",
  "reports_analytics",
  "other",
]);

function categoryOf(value: string): KnowledgeCategory {
  return KNOWLEDGE_CATEGORIES.has(value as KnowledgeCategory) ? (value as KnowledgeCategory) : "policies_compliance";
}

/**
 * Drop a [S#] the turn does not have.
 *
 * Eight retrieved sources make [S1] through [S8] real. [S11] is not one of
 * them and must not be shown.
 */
export function dropUnknownSourceMarkers(content: string, sourceCount: number): string {
  const next = content.replace(/\[S(\d{1,2})\]/g, (full, raw: string) => {
    const marker = Number(raw);
    if (Number.isInteger(marker) && marker >= 1 && marker <= sourceCount) return full;
    return "";
  });
  return tidy(next);
}

/**
 * Keep a citation only when that manual has the page and the heading is on
 * it. A heading that lives on a different page is rewritten to that page.
 * Anything else is removed.
 */
export function validateManualCitations(
  content: string,
  manuals: readonly AssembledManual[],
): { readonly content: string; readonly citations: readonly SourceCitation[] } {
  if (manuals.length === 0) return { content, citations: [] };
  const titles = [...new Set(manuals.flatMap((manual) => [manual.title, manual.displayTitle]))]
    .filter((title) => title.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  /*
   * The comma before the manual title is the citation. The words in front
   * of the heading stay: replacing the whole capture trimmed "Director"
   * down to "Dir" and "large." into the label.
   */
  const pattern = new RegExp(
    `([^,\\n]{2,160}?),\\s+(${titles.map(escapeRegExp).join("|")})\\s+p\\.(\\d{1,4})\\b`,
    "gi",
  );
  const citations: SourceCitation[] = [];
  const seen = new Set<string>();
  const next = content.replace(pattern, (_full, headingRaw: string, titleRaw: string, pageRaw: string) => {
    const manual = manualForTitle(manuals, titleRaw);
    const citedPage = Number(pageRaw);
    if (!manual || !Number.isInteger(citedPage)) return "";
    /*
     * "Crunch Shirts" is not the Sun Tan City Shirts heading. Crunch and
     * Buff sections print on page 16 and are not a Sunny source, so a
     * p.17 cite of them is dropped rather than retargeted.
     */
    if (namesExcludedBrand(headingRaw)) return "";
    const heading = headingFromQuote(manual, headingRaw);
    if (!heading) return "";
    const located = headingOnPage(manual, heading, citedPage)
      ? citedPage
      : (pagesForHeading(manual, heading)[0] ?? null);
    if (located === null) return "";
    const line = citationLine(headingRaw, heading, manual.displayTitle, located);
    const key = `${manual.id}\0${headingKey(heading)}\0${located}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push(citationFor(manual, heading, located));
    }
    return line;
  });
  return { content: tidy(next), citations };
}

function citationFor(manual: AssembledManual, heading: string, page: number): SourceCitation {
  return {
    documentId: manual.id,
    documentTitle: manual.displayTitle,
    locator: `Page ${page}`,
    category: categoryOf(manual.category),
    excerpt: heading,
    relevance: 1,
  };
}

/*
 * ============================================================================
 * PRINTED PAGES ON A FULL-MANUAL ANSWER
 * ============================================================================
 *
 * The answer is read one sentence (or bullet line) at a time. Only [p.N]
 * markers are removed or added, and only the page number inside a
 * "<section>, JBA Policy Manual p.N" label may change. Every other word,
 * line break and bullet stays as the model wrote it.
 *
 * 24 Oct 2026: f44631a cut words at commas ("chains, Belts, JBA Policy
 * Manual p.15"), kept p.15 for Facial Hair and Make-up (printed 16), and
 * cited the cover (p.1), termination payout (p.22) and bereavement (p.47)
 * on a PTO answer.
 */

const HEADING_STOP = new Set([
  "dress",
  "code",
  "specific",
  "policy",
  "policies",
  "section",
  "manual",
  "company",
  "locations",
  "location",
  "employees",
  "employee",
  "about",
  "other",
  "workplace",
  "safety",
  "security",
  "customer",
  "customers",
  "management",
  "holiday",
  "holidays",
  "benefits",
  "records",
  "office",
  "corporate",
  "acceptable",
  "required",
  "permitted",
  "personal",
  "phone",
  "phones",
]);

const OVERLAP_STOP = new Set([
  ...HEADING_STOP,
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "been",
  "being",
  "does",
  "each",
  "from",
  "have",
  "into",
  "more",
  "must",
  "only",
  "should",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "your",
]);

/*
 * "It's" and "it is", ’ and ', are the same words. The manual prints "It is
 * the Employee's personal responsibility"; an answer saying "It's the
 * employee's responsibility" must match it on the same words (QA P0, 24 Oct
 * 2026; ported from Ask Bubbles).
 */
const CONTRACTIONS: readonly [RegExp, string][] = [
  [/\b(it|that|there|what|who)'s\b/g, "$1 is"],
  [/\bcan't\b/g, "cannot"],
  [/\bwon't\b/g, "will not"],
  [/\b(is|are|was|were|do|does|did|has|have|had|should|would|could|must)n't\b/g, "$1 not"],
];

/*
 * "Feb 1" is the manual's "February 1" (QA B-list, 25 Oct 2026; ported from
 * the sibling app). Only before a day number, so "may" and "dec" elsewhere
 * are left alone.
 */
const MONTHS: Record<string, string> = {
  jan: "january",
  feb: "february",
  mar: "march",
  apr: "april",
  jun: "june",
  jul: "july",
  aug: "august",
  sep: "september",
  oct: "october",
  nov: "november",
  dec: "december",
};
const SHORT_MONTH = /\b(jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(?=\d)/g;

/*
 * A sentence's first word is not a heading (QA B-list, 25 Oct 2026; ported
 * from the sibling app, where "Anyone violating…" became "Page 15 — Anyone").
 */
const FRAGMENT_HEADING = /^(?:anyone|everyone|someone|no one|employees?|all|each|any|every|none|this|these|those|they|you|we|it)$/i;

function wordsOf(text: string): string {
  let folded = text.toLowerCase().replace(/[’‘`´]/g, "'");
  for (const [pattern, replacement] of CONTRACTIONS) folded = folded.replace(pattern, replacement);
  folded = folded.replace(SHORT_MONTH, (_whole, month: string) => `${MONTHS[month.slice(0, 3)]} `);
  return folded
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The longest phrase a sentence shares with a passage that carries two
 * distinctive words, or one in five words or more. "employees are
 * responsible for" (Lost and Found) and "must be clean and" (every brand's
 * shirt rule) do not say which page a sentence restates.
 */
const passageWords = new Map<string, string[]>();

/** A passage's words, read once per passage text. */
function wordsList(text: string): string[] {
  const cached = passageWords.get(text);
  if (cached) return cached;
  const words = wordsOf(text).split(" ").filter(Boolean);
  if (passageWords.size > 5000) passageWords.clear();
  passageWords.set(text, words);
  return words;
}

/** Whether a shared run of words is a phrase that says which page it came from. */
function restates(slice: readonly string[]): boolean {
  if (slice.join(" ").length < 16) return false;
  const distinctive = slice.filter((word) => word.length >= 5 && !OVERLAP_STOP.has(word));
  return distinctive.length >= 2 || (slice.length >= 5 && distinctive.length >= 1);
}

/**
 * BOILERPLATE IS NOT A RESTATEMENT (QA P0, 24 Oct 2026; ported from Ask
 * Bubbles). "the employee's responsibility to" is printed on pages 9, 10,
 * 14, 26, 31 and 48, so a cell-phone sentence sharing it was cited on all of
 * them while page 19, whose words it restates, lost on length. A phrase
 * printed on three or more pages of one manual says nothing about which page
 * a sentence came from.
 */
interface PhrasePages {
  /** Each four-word run of the manual, and the pages it is printed on. */
  readonly grams: Map<string, Set<number>>;
  /** Each page's words, passages kept apart so no phrase runs across two. */
  readonly pageWords: Map<number, string>;
}

const BOILERPLATE_PAGES = 3;
const phrasePagesCache = new WeakMap<readonly ManualPassage[], PhrasePages>();

function phrasePagesOf(passages: readonly ManualPassage[]): PhrasePages {
  const cached = phrasePagesCache.get(passages);
  if (cached) return cached;
  const grams = new Map<string, Set<number>>();
  const pageParts = new Map<number, string[]>();
  for (const passage of passages) {
    const words = wordsList(passage.text);
    for (let at = 0; at + 4 <= words.length; at += 1) {
      const key = words.slice(at, at + 4).join(" ");
      const pages = grams.get(key);
      if (pages) pages.add(passage.page);
      else grams.set(key, new Set([passage.page]));
    }
    const parts = pageParts.get(passage.page) ?? [];
    parts.push(words.join(" "));
    pageParts.set(passage.page, parts);
  }
  const pageWords = new Map([...pageParts].map(([page, parts]) => [page, ` ${parts.join(" | ")} `]));
  const built = { grams, pageWords };
  phrasePagesCache.set(passages, built);
  return built;
}

/** Whether a run of words is printed on three or more pages of the manual. */
function isBoilerplate(slice: readonly string[], index: PhrasePages): boolean {
  if (slice.length < 4) return false;
  let candidates = new Set<number>(index.grams.get(slice.slice(0, 4).join(" ")) ?? []);
  for (let at = 0; at + 4 <= slice.length && candidates.size >= BOILERPLATE_PAGES; at += 1) {
    const pages = index.grams.get(slice.slice(at, at + 4).join(" "));
    candidates = new Set([...candidates].filter((page) => pages?.has(page)));
  }
  if (candidates.size < BOILERPLATE_PAGES) return false;
  const phrase = ` ${slice.join(" ")} `;
  let printed = 0;
  for (const page of candidates) {
    if (index.pageWords.get(page)?.includes(phrase)) printed += 1;
    if (printed >= BOILERPLATE_PAGES) return true;
  }
  return false;
}

function restatedPhraseLength(answer: string, passage: string, index?: PhrasePages): number {
  const said = wordsList(answer);
  const words = wordsList(passage);
  if (said.length < 4 || words.length < 4) return 0;
  const starts = new Map<string, number[]>();
  for (let from = 0; from + 4 <= said.length; from += 1) {
    const key = said.slice(from, from + 4).join(" ");
    const list = starts.get(key);
    if (list) list.push(from);
    else starts.set(key, [from]);
  }
  let best = 0;
  for (let at = 0; at + 4 <= words.length; at += 1) {
    const hits = starts.get(words.slice(at, at + 4).join(" "));
    if (!hits) continue;
    for (const from of hits) {
      let run = 4;
      while (at + run < words.length && from + run < said.length && words[at + run] === said[from + run]) run += 1;
      /*
       * Every window inside a shared run is shared too. Take the longest
       * window (at most 14 words) that names its page.
       */
      for (let size = Math.min(14, run); size > best && size >= 4; size -= 1) {
        let found = false;
        for (let offset = 0; offset + size <= run; offset += 1) {
          const slice = words.slice(at + offset, at + offset + size);
          if (restates(slice) && !(index && isBoilerplate(slice, index))) {
            found = true;
            break;
          }
        }
        if (found) {
          best = size;
          break;
        }
      }
    }
  }
  return best;
}

/** The distinct words of five letters or more that say something. */
function distinctiveCount(text: string): number {
  return new Set(wordsOf(text).split(" ").filter((word) => word.length >= 5 && !OVERLAP_STOP.has(word))).size;
}

function overlapScore(answer: string, passage: string): number {
  const hay = new Set(wordsOf(answer).split(" ").filter((word) => word.length >= 5 && !OVERLAP_STOP.has(word)));
  const seen = new Set<string>();
  let score = 0;
  for (const word of wordsOf(passage).split(" ")) {
    if (word.length < 5 || OVERLAP_STOP.has(word) || !hay.has(word) || seen.has(word)) continue;
    seen.add(word);
    score += 1;
  }
  return score;
}

interface PassageHit {
  readonly manual: AssembledManual;
  readonly passage: ManualPassage;
}

function passagesOf(manuals: readonly AssembledManual[]): PassageHit[] {
  return manuals.flatMap((manual) => manual.passages.map((passage) => ({ manual, passage })));
}

/** The passages a sentence restates, by longest shared phrase. */
function restatedPassages(text: string, hits: readonly PassageHit[]): PassageHit[] {
  let best = 0;
  let chosen: PassageHit[] = [];
  for (const hit of hits) {
    const phrase = restatedPhraseLength(text, hit.passage.text, phrasePagesOf(hit.manual.passages));
    if (phrase < 4 || phrase < best) continue;
    if (phrase > best) {
      best = phrase;
      chosen = [];
    }
    chosen.push(hit);
  }
  return dominantPages(text, outsaid(text, chosen, hits));
}

/*
 * A PAGE THAT SAYS CLEARLY MORE OF THE SENTENCE WINS, EVEN WITHOUT THE
 * LONGEST PHRASE (live, 25 Oct 2026; ported from the sibling app). "Dress
 * code violations can lead to being sent home to change and are subject to
 * disciplinary action, up to and including termination" shares that
 * discipline clause word for word only with Retaliation (23) and the Bonus
 * Policy (38). The Dress Code page (15) prints "up to and potentially
 * including termination", so its longest phrase is shorter, but it is the
 * page that says "dress code", "sent home" and "change". The discipline words
 * are printed on dozens of pages and say little about which page a sentence
 * restates; "dress", "home" and "sent" are printed on a few. Each shared word
 * counts by how few pages print it, and a page whose words count for clearly
 * more (half as much again as any tied page), sharing as many distinctive
 * words, is cited instead. "Payout on termination follows state and federal
 * guidelines" stays where it was: the smoking page's "state and federal"
 * counts for only a little more.
 */
const OUTSAID = 2 / 3;

function outsaid(text: string, tied: readonly PassageHit[], hits: readonly PassageHit[]): PassageHit[] {
  if (tied.length === 0) return [...tied];
  const rarity = wordRarityOf(hits);
  const tiedPages = new Set(tied.map((hit) => hit.passage.page));
  const tiedBest = Math.max(...tied.map((hit) => rareOverlap(text, hit.passage.text, rarity)));
  let best: PassageHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    const score = rareOverlap(text, hit.passage.text, rarity);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  // It also shares at least as many distinctive words as the closest tied page: two rare words are not a page.
  const tiedWords = Math.max(...tied.map((hit) => overlapScore(text, hit.passage.text)));
  if (!best || tiedPages.has(best.passage.page) || overlapScore(text, best.passage.text) < Math.max(4, tiedWords)) {
    return [...tied];
  }
  return tiedBest < OUTSAID * bestScore ? [best] : [...tied];
}

const wordRarityCache = new WeakMap<readonly PassageHit[], ReadonlyMap<string, number>>();

/** log(pages / pages that print the word), for each word of four or more letters. */
function wordRarityOf(hits: readonly PassageHit[]): ReadonlyMap<string, number> {
  const cached = wordRarityCache.get(hits);
  if (cached) return cached;
  const pagesOf = new Map<string, Set<number>>();
  const allPages = new Set<number>();
  for (const hit of hits) {
    allPages.add(hit.passage.page);
    for (const word of rareCandidates(hit.passage.text)) {
      const pages = pagesOf.get(word);
      if (pages) pages.add(hit.passage.page);
      else pagesOf.set(word, new Set([hit.passage.page]));
    }
  }
  const rarity = new Map<string, number>();
  for (const [word, pages] of pagesOf) rarity.set(word, Math.log(allPages.size / pages.size));
  wordRarityCache.set(hits, rarity);
  return rarity;
}

function rareCandidates(text: string): Set<string> {
  return new Set(wordsOf(text).split(" ").filter((word) => word.length >= 4 && !OVERLAP_STOP.has(word)));
}

/** The sentence's words the passage prints too, each counted by how few pages print it. */
function rareOverlap(text: string, passageText: string, rarity: ReadonlyMap<string, number>): number {
  const hay = rareCandidates(passageText);
  let score = 0;
  for (const word of rareCandidates(text)) if (hay.has(word)) score += rarity.get(word) ?? 0;
  return score;
}

/*
 * ONE PAGE THAT SAYS MORE WINS (QA B3, 25 Oct 2026; ported from the sibling
 * app). Pages tied on the longest shared phrase are kept only where they
 * share nearly as many of the sentence's distinctive words as the best page
 * does, and a sentence carries at most two pages. "…texting, making calls,
 * or using social media while on duty jeopardizes that experience" restates
 * the Cell Phone policy (19), not Using Social Media at Work (23) or
 * Employee Injury (26); "…may be subject to disciplinary action, up to and
 * including termination" restates the dress code (15), not the Bonus Policy
 * (38) or Retaliation (23), which print the same discipline clause.
 */
const DOMINANCE = 0.75;
const MAX_PAGES_PER_SENTENCE = 2;

function dominantPages(text: string, tied: readonly PassageHit[]): PassageHit[] {
  if (tied.length <= 1) return [...tied];
  const scored = tied.map((hit) => ({ hit, score: overlapScore(text, hit.passage.text) }));
  const best = Math.max(...scored.map((entry) => entry.score));
  const kept = scored.filter((entry) => entry.score >= DOMINANCE * best).sort((a, b) => b.score - a.score);
  const pages: number[] = [];
  const out: PassageHit[] = [];
  for (const entry of kept) {
    const page = entry.hit.passage.page;
    if (!pages.includes(page)) {
      if (pages.length >= MAX_PAGES_PER_SENTENCE) continue;
      pages.push(page);
    }
    out.push(entry.hit);
  }
  return out;
}

/** A model page stays only when a passage on it shares four distinctive words with the sentence. */
function confirmedModelPages(text: string, pages: readonly number[], hits: readonly PassageHit[]): PassageHit[] {
  const kept: PassageHit[] = [];
  for (const page of pages) {
    let best: PassageHit | null = null;
    let bestScore = 0;
    for (const hit of hits) {
      if (hit.passage.page !== page) continue;
      const score = overlapScore(text, hit.passage.text);
      if (score > bestScore) {
        best = hit;
        bestScore = score;
      }
    }
    /*
     * Four shared words must also be a real share of what the sentence says
     * (QA B-list, 25 Oct 2026; ported from the sibling app: "…and the prior
     * coaching reference" shared ordinary words with Time Records). A
     * manager's note is not a page.
     */
    if (best && bestScore >= 4 && bestScore >= 0.4 * distinctiveCount(text)) kept.push(best);
  }
  return kept;
}

/** One passage with five or more distinctive words in common, on a page no other passage ties. */
function closestPassage(text: string, hits: readonly PassageHit[]): PassageHit[] {
  let best: PassageHit[] = [];
  let bestScore = 0;
  for (const hit of hits) {
    const score = overlapScore(text, hit.passage.text);
    // The same share rule as a model page.
    if (score < 5 || score < 0.4 * distinctiveCount(text) || score < bestScore) continue;
    if (score > bestScore) {
      bestScore = score;
      best = [];
    }
    best.push(hit);
  }
  return new Set(best.map((hit) => hit.passage.page)).size === 1 ? best.slice(0, 1) : [];
}

/*
 * "[p.16-17]" and "[pp.16–17]" are markers too (QA B-list, 25 Oct 2026; ported
 * from the sibling app, where a range stayed beside the page the sentence
 * restates). They are taken off like any other marker; the pages they name
 * count as the model's pages.
 */
const PRINTED_MARKER = /[^\S\n]*\[pp?\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\]/gi;

/** The pages a marker names: one page, or each page of a short range. */
function markerPages(match: RegExpMatchArray): number[] {
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (to < from || to - from > 5) return [from];
  return Array.from({ length: to - from + 1 }, (_unused, offset) => from + offset);
}

/** Markers out. "expense[p.15]and" keeps a space between the two words. */
function withoutPrintedMarkers(text: string): string {
  const bare = text.replace(/[^\S\n]*\[pp?\.\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\]/gi, (full, offset: number, whole: string) =>
    /^[\p{L}\p{N}]/u.test(whole.slice(offset + full.length)) && offset > 0 ? " " : "",
  );
  return /^[^\S\n]*\[pp?\.\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\]/i.test(text) ? bare.trimStart() : bare;
}

/**
 * One line cut into sentences. The text between them is kept, so joining
 * them gives the line back. A piece that is only markers ("…p.15. [p.15]")
 * belongs to the sentence before it.
 */
function stretchesOf(line: string): { text: string; gap: string }[] {
  const parts = line.split(/((?<=[.!?])[^\S\n]+)/);
  const stretches: { text: string; gap: string }[] = [];
  for (let at = 0; at < parts.length; at += 2) {
    const text = parts[at] ?? "";
    const gap = parts[at + 1] ?? "";
    const previous = stretches[stretches.length - 1];
    if (previous && /^(?:\[pp?\.\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\][\s)\].,;:]*)+$/i.test(text.trim())) {
      previous.text = `${previous.text}${previous.gap}${text}`;
      previous.gap = gap;
      continue;
    }
    stretches.push({ text, gap });
  }
  return stretches;
}

/** Markers go before the sentence's closing punctuation, or at its end. */
function markStretch(text: string, pages: readonly number[]): string {
  if (pages.length === 0) return text;
  const markers = [...pages].sort((left, right) => left - right).map((page) => `[p.${page}]`).join(" ");
  const closing = text.match(/[.!?:;]+["'”’)*_]*$/);
  if (closing && closing.index !== undefined && closing.index > 0) {
    return `${text.slice(0, closing.index).trimEnd()} ${markers}${text.slice(closing.index)}`;
  }
  return `${text.trimEnd()} ${markers}`;
}

function escapeLabelTitle(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A one-word heading that is only a piece of the manual's title ("Manual"). */
function titleFragment(heading: string, manual: AssembledManual): boolean {
  const key = headingKey(heading);
  const title = headingKey(manual.displayTitle);
  if (!key || !title) return false;
  if (key === title) return true;
  const words = key.split(" ");
  return words.length === 1 && title.split(" ").includes(words[0] ?? "");
}

/**
 * The heading whose whole words end `before`, longest first ("Facial Hair"
 * over "Hair"). A heading glued onto the previous word by an earlier cut
 * ("Salon DirEligibility") still counts when its capital shows the seam.
 */
function headingEnding(before: string, manual: AssembledManual): string | null {
  const window = headingKey(before.slice(-200));
  const raw = before.replace(/[\s"'“”(]+$/, "");
  let best: string | null = null;
  for (const heading of knownHeadings(manual)) {
    if (titleFragment(heading, manual)) continue;
    const key = headingKey(heading);
    if (key.length < 3 || !window.endsWith(key)) continue;
    const start = window.length - key.length;
    if (start > 0 && window[start - 1] !== " ") {
      const seam = raw.length - heading.length;
      const glued =
        seam > 0 &&
        raw.slice(seam).toLowerCase() === heading.toLowerCase() &&
        /[a-z]/.test(raw[seam - 1] ?? "") &&
        /[A-Z]/.test(raw[seam] ?? "");
      if (!glued) continue;
    }
    if (!best || key.length > headingKey(best).length) best = heading;
  }
  return best;
}

function pagesWithHeading(manual: AssembledManual, heading: string): number[] {
  const key = headingKey(heading);
  return manual.pages
    .filter((entry) => entry.headings.some((item) => headingKey(item) === key))
    .map((entry) => entry.page);
}

interface LabelHit {
  readonly manual: AssembledManual;
  readonly heading: string;
  readonly page: number;
}

/**
 * The page for a "<section>, <manual> p.N" label (QA, 24 Oct 2026):
 * a section printed on one page takes that page; a section printed on
 * several keeps the model's page when it is one of them, else the page whose
 * passage the sentence restates; anything else is no page.
 */
function labelPage(
  manual: AssembledManual,
  heading: string,
  written: number,
  sentence: string,
): number | null {
  const pages = pagesWithHeading(manual, heading);
  if (pages.length === 1) return pages[0]!;
  if (pages.length === 0) return null;
  if (pages.includes(written)) return written;
  const key = headingKey(heading);
  const own = manual.passages
    .filter((passage) => pages.includes(passage.page) && headingKey(passage.heading ?? "") === key)
    .map((passage) => ({ manual, passage }));
  const restated = [...new Set(restatedPassages(sentence, own).map((hit) => hit.passage.page))];
  return restated.length === 1 ? restated[0]! : null;
}

/**
 * Labels in one sentence. A label's page number becomes the printed page,
 * and one [p.N] follows it. A label with no page keeps its words and gets no
 * marker. A sentence about Buff City Soap or Crunch is left as written.
 */
function markLabels(
  sentence: string,
  manuals: readonly AssembledManual[],
): { readonly text: string; readonly labels: readonly LabelHit[]; readonly found: boolean } {
  const labels: LabelHit[] = [];
  let found = false;
  let text = sentence;
  for (const manual of manuals) {
    const titles = [...new Set([manual.displayTitle, manual.title])]
      .filter((title) => title.trim().length > 0)
      .sort((a, b) => b.length - a.length)
      .map(escapeLabelTitle);
    if (titles.length === 0) continue;
    const pattern = new RegExp(`(,\\s+(?:${titles.join("|")})\\s+p\\.)(\\d{1,4})\\b`, "gi");
    text = text.replace(pattern, (full: string, lead: string, raw: string, offset: number, whole: string) => {
      found = true;
      if (namesExcludedBrand(sentence)) return full;
      const heading = headingEnding(whole.slice(0, offset), manual);
      if (!heading) return full;
      const page = labelPage(manual, heading, Number(raw), sentence);
      if (page === null) return full;
      labels.push({ manual, heading, page });
      return `${lead}${page} [p.${page}]`;
    });
  }
  return { text, labels, found };
}

/**
 * The model's answer with each printed page marked where the sentence states
 * it, and a Sources row for each marked section.
 *
 * Only [p.N] and [S#] markers are removed or added, and only the page number
 * inside a "<section>, JBA Policy Manual p.N" label changes. A page number
 * anywhere else ("see page 99", a DM manual page) stays as written with no
 * marker. A page the manual does not print, or whose text the sentence does
 * not restate, is not marked.
 */
export function applyFullManualAnswer(input: {
  readonly content: string;
  readonly manuals: readonly AssembledManual[];
  readonly sourceCount: number;
}): { readonly content: string; readonly citations: readonly SourceCitation[] } {
  if (input.manuals.length === 0) {
    return { content: dropUnknownSourceMarkers(input.content, input.sourceCount), citations: [] };
  }
  /*
   * [S#] counts retrieved chunks. This answer's sources are printed pages,
   * so a marker such as [S9] or [S11] cannot point at one of them.
   */
  const withoutSources = input.content.replace(/[^\S\n]*\[S\d{1,2}\]/g, "");
  const hits = passagesOf(input.manuals);
  const marked: { manual: AssembledManual; heading: string; page: number }[] = [];

  const content = withoutSources
    .split("\n")
    .map((line) => {
      const stretches = stretchesOf(line);
      return stretches
        .map(({ text, gap }, at) => {
          const written = [...text.matchAll(PRINTED_MARKER)].flatMap(markerPages);
          const bare = withoutPrintedMarkers(text);
          // A sentence that was only markers leaves nothing, not a gap.
          if (!bare.trim()) return text.trim() ? "" : `${text}${gap}`;
          const labelled = markLabels(bare, input.manuals);
          for (const label of labelled.labels) marked.push(label);
          if (labelled.found || namesExcludedBrand(bare)) return `${labelled.text}${gap}`;
          // "…stay covered. (Tattoos, JBA Policy Manual p.16)": the label that follows carries the page.
          const next = stretches[at + 1]?.text ?? "";
          if (markLabels(withoutPrintedMarkers(next), input.manuals).found) return `${bare}${gap}`;
          let restated = restatedPassages(bare, hits);
          if (restated.length === 0) {
            const pages = [...new Set(written)].filter((page) =>
              input.manuals.some((manual) => manual.pages.some((entry) => entry.page === page)),
            );
            restated = confirmedModelPages(bare, pages, hits);
          }
          if (restated.length === 0) restated = closestPassage(bare, hits);
          for (const hit of restated) {
            const own = hit.passage.heading && !FRAGMENT_HEADING.test(hit.passage.heading.trim()) ? hit.passage.heading : null;
            const heading =
              own ??
              hit.manual.pages
                .find((entry) => entry.page === hit.passage.page)
                ?.headings.find((name) => !FRAGMENT_HEADING.test(name.trim())) ??
              null;
            if (heading) marked.push({ manual: hit.manual, heading, page: hit.passage.page });
          }
          const pages = [...new Set(restated.map((hit) => hit.passage.page))];
          return `${markStretch(bare, pages)}${gap}`;
        })
        .join("")
        .replace(/[^\S\n]+$/, "");
    })
    .join("\n");

  const citations: SourceCitation[] = [];
  const seen = new Set<string>();
  for (const item of marked) {
    const key = `${item.manual.id}\0${headingKey(item.heading)}\0${item.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citationFor(item.manual, item.heading, item.page));
  }
  return { content, citations };
}
