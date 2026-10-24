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

export interface AssembledManual {
  readonly id: string;
  readonly title: string;
  readonly displayTitle: string;
  readonly category: string;
  readonly text: string;
  readonly tokens: number;
  readonly pages: readonly ManualPage[];
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
    let blockSection: string | null = active === "excluded" ? null : section || null;
    let lines: string[] = [];

    const flush = () => {
      const content = lines.join("\n").trim();
      if (active === "excluded" || !content) return;
      kept.push({
        chunkIndex: chunk.chunkIndex + piece * 1e-6,
        page: chunk.page,
        printedPage: chunk.printedPage,
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

function tidy(text: string): string {
  return text
    .replace(/\b(?:see|also)\s+(?=[.,;:]|$)/gi, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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


const TOPIC_STOP = new Set([
  "what",
  "is",
  "the",
  "a",
  "an",
  "for",
  "of",
  "to",
  "and",
  "or",
  "policy",
  "policies",
  "rule",
  "rules",
  "does",
  "do",
  "how",
  "when",
  "where",
  "who",
  "which",
  "about",
  "this",
  "that",
  "with",
  "from",
  "are",
  "was",
]);

function topicTokens(question: string): string[] {
  return headingKey(question)
    .split(" ")
    .filter((token) => token.length > 2 && !TOPIC_STOP.has(token));
}

function headingMatchesTopic(heading: string, topics: readonly string[]): boolean {
  const key = headingKey(heading);
  if (!key || topics.length === 0) return false;
  return topics.some((topic) => key.includes(topic));
}

/**
 * Pages that answer the question.
 *
 * A heading that shares the question's topic starts a run. Later pages stay
 * in that run until a new major heading starts the page. The cover, a
 * termination payout, and bereavement do not stay in a PTO run. Shirts,
 * Pants, and Tanning stay in a dress-code run when they do not start a new
 * major section.
 */
function relevantPages(question: string, manuals: readonly AssembledManual[]): Set<number> | null {
  const topics = topicTokens(question);
  if (topics.length === 0) return null;
  const relevant = new Set<number>();
  let open = false;
  for (const manual of manuals) {
    const pages = [...manual.pages].sort((a, b) => a.page - b.page);
    for (const page of pages) {
      const first = page.headings[0] ?? "";
      const own = page.headings.some((heading) => headingMatchesTopic(heading, topics));
      const matchedMajor = page.headings.find(
        (heading) => isMajorHeading(heading) && headingMatchesTopic(heading, topics),
      );
      const breaks =
        !matchedMajor &&
        isMajorHeading(first) &&
        !headingMatchesTopic(first, topics) &&
        !APPEARANCE_SECTION.test(first);
      if (matchedMajor) open = true;
      else if (breaks) open = false;
      if (own || (open && !breaks)) relevant.add(page.page);
      else open = false;
    }
  }
  return relevant.size > 0 ? relevant : null;
}

function isMajorHeading(heading: string): boolean {
  return MAJOR_SECTION.test(heading) || /dress code/i.test(heading);
}

function pageExists(manuals: readonly AssembledManual[], page: number): AssembledManual | undefined {
  return manuals.find((manual) => manual.pages.some((entry) => entry.page === page));
}

function pageAllowed(page: number, manuals: readonly AssembledManual[], relevant: Set<number> | null): boolean {
  if (!pageExists(manuals, page)) return false;
  if (relevant === null) return true;
  return relevant.has(page);
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

/** A one-word heading that is only a piece of the manual's title ("Manual"). */
function titleFragment(heading: string, manual: AssembledManual): boolean {
  const key = headingKey(heading);
  const title = headingKey(manual.displayTitle);
  if (!key || !title || key === title) return key === title;
  const words = key.split(" ");
  return words.length === 1 && title.split(" ").includes(words[0] ?? "");
}

function headingNamed(before: string, manual: AssembledManual, page: number): string | null {
  const entry = manual.pages.find((item) => item.page === page);
  if (!entry) return null;
  const window = headingKey(before.slice(-400));
  let best: { heading: string; end: number; length: number } | null = null;
  for (const heading of entry.headings) {
    if (titleFragment(heading, manual)) continue;
    const key = headingKey(heading);
    if (key.length < 3) continue;
    const index = window.lastIndexOf(key);
    if (index < 0) continue;
    const end = index + key.length;
    const boundaryBefore = index === 0 || window[index - 1] === " ";
    const boundaryAfter = end === window.length || window[end] === " ";
    if (!boundaryBefore || !boundaryAfter) continue;
    // "Hair" also sits inside "Facial Hair". The heading that ends nearest the
    // marker wins, and the longer heading wins when both end in the same place.
    if (!best || end > best.end || (end === best.end && key.length > best.length)) {
      best = { heading, end, length: key.length };
    }
  }
  if (best) return best.heading;
  return entry.headings.find((heading) => !titleFragment(heading, manual)) ?? entry.headings[0] ?? null;
}

function pagesNamed(sentence: string): number[] {
  const pages: number[] = [];
  for (const match of sentence.matchAll(/(?<!\[)\bpp?\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gi)) {
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 30) continue;
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return pages;
}

/** The period in `p.15` or `pp.3-5` is a page reference, not the end of a sentence. */
function isPageReferenceDot(text: string, index: number): boolean {
  if (text[index] !== ".") return false;
  return /(?:^|[^a-z0-9])pp?$/i.test(text.slice(0, index)) && /^\s*\d/.test(text.slice(index + 1));
}

function decorateSentence(sentence: string, allowed: (page: number) => boolean): string {
  const missing = [...new Set(pagesNamed(sentence))].filter(
    (page) => allowed(page) && !new RegExp(`\\[p\\.${page}\\]`).test(sentence),
  );
  if (missing.length === 0) return sentence;
  const trailing = /(\s*)$/.exec(sentence);
  const end = trailing?.[1] ?? "";
  const core = sentence.slice(0, sentence.length - end.length);
  return `${core} ${missing.map((page) => `[p.${page}]`).join(" ")}${end}`;
}

/**
 * `[p.N]` after a sentence that already names that page.
 *
 * The sentence is not rewritten. A marker that is already there is not repeated.
 * A period that belongs to `p.N` stays inside the sentence, so the marker is
 * not inserted between `p.` and the page number.
 */
function appendSentenceMarkers(text: string, allowed: (page: number) => boolean): string {
  let out = "";
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\n") {
      out += decorateSentence(text.slice(start, index), allowed);
      out += "\n";
      start = index + 1;
      continue;
    }
    if ((ch === "." || ch === "!" || ch === "?") && !isPageReferenceDot(text, index)) {
      let end = index + 1;
      while (end < text.length && /["')\]]/.test(text[end] ?? "")) end += 1;
      out += decorateSentence(text.slice(start, end), allowed);
      start = end;
      index = end - 1;
    }
  }
  return out + decorateSentence(text.slice(start), allowed);
}

function collapseMarkerGaps(text: string): string {
  return text
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function citationsFromMarkers(
  content: string,
  manuals: readonly AssembledManual[],
): readonly SourceCitation[] {
  const citations: SourceCitation[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/\[p\.(\d{1,4})\]/g)) {
    const page = Number(match[1]);
    const manual = pageExists(manuals, page);
    if (!manual || match.index === undefined) continue;
    const heading = headingNamed(content.slice(0, match.index), manual, page);
    if (!heading) continue;
    const key = `${manual.id}\0${headingKey(heading)}\0${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citationFor(manual, heading, page));
  }
  return citations;
}

/**
 * Leave the model's words as they were written.
 *
 * The only edits are appending `[p.N]` after a sentence that already names
 * that printed page, and removing a `[p.N]` or `[S#]` marker whose page is
 * not a Sources row. A page that does not answer the question is not a
 * Sources row, so its marker is removed and the sentence stays.
 */
export function applyFullManualAnswer(input: {
  readonly content: string;
  readonly manuals: readonly AssembledManual[];
  readonly sourceCount: number;
  readonly question?: string;
}): { readonly content: string; readonly citations: readonly SourceCitation[] } {
  if (input.manuals.length === 0) {
    return { content: dropUnknownSourceMarkers(input.content, input.sourceCount), citations: [] };
  }
  const relevant = input.question ? relevantPages(input.question, input.manuals) : null;
  const allowed = (page: number) => pageAllowed(page, input.manuals, relevant);
  const withoutForeignMarkers = input.content.replace(/\[S\d{1,2}\]/g, "");
  const kept = withoutForeignMarkers.replace(/\[p\.(\d{1,4})\]/g, (full, raw: string) =>
    allowed(Number(raw)) ? full : "",
  );
  const marked = appendSentenceMarkers(kept, allowed);
  const content = collapseMarkerGaps(marked);
  return { content, citations: citationsFromMarkers(content, input.manuals) };
}
