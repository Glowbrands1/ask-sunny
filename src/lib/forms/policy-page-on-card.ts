import { CA_POLICY_LABEL, type CaPolicyName } from "./ca-policy";
import {
  findManualSection,
  headingKey,
  OFFENSE_MANUAL_SECTIONS,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * POLICY_PAGE_ON_CARD_ENABLED: the printed page beside the policy on the form
 * card (QA, 25 Oct 2026: "Policy: Standards of Conduct" with no page; it is
 * p.12. Late Opening is p.15).
 *
 * The page is the one of the section the app itself cites for that policy:
 * `OFFENSE_MANUAL_SECTIONS` names it ("Dress Code" is the manual's "Dress Code
 * for The Company", p.15), and `findManualSection` finds it on the sheet its
 * heading is printed on — the same pick the draft's Direct policy line makes,
 * so the card and the form name the same page. The page is the printed page
 * stored with that heading in the chunk metadata, never the PDF sheet column.
 * A policy the manual has no section for (Under Performance, Violation of
 * Company Policies), or a section found only through the contents page, gets
 * no page. A section whose own chunk the locator says runs over two printed
 * pages ("Pages 26–27 — <heading>") is "pp.26–27".
 *
 * Only a line the app writes itself is changed, and only when it holds
 * exactly one of the app's own policy names (`CARD_POLICY_HEADINGS`):
 *
 *   **Policy:** Standards of Conduct, as you said
 *   **Policy:** Late Opening
 *   **Policy:** this reads as **Standards of Conduct** — …
 *
 * A line that already gives a page, a phrase the manager typed (it is quoted:
 * `**Policy:** "visitors at work", as you said`) and every other line stay as
 * they are. The heading is never renamed. Off, nothing here runs.
 */

const MANUAL = "JBA Policy Manual";

/** The policy names the app writes on a card itself, from its own readers. */
export const CARD_POLICY_HEADINGS: readonly string[] = [
  ...new Set([...Object.values(CA_POLICY_LABEL), "Late Opening"]),
];

/** Labels whose box names no section of the manual, by design (see `OFFENSE_MANUAL_SECTIONS`). */
const NO_SECTION: ReadonlySet<CaPolicyName> = new Set(["under_performance", "company_policies"]);

/** The manual section the app cites for a policy name, or null. */
export function citedSectionFor(heading: string, chunks: readonly ManualChunk[]): ManualSection | null {
  const key = headingKey(heading);
  if (!key) return null;
  const label = (Object.keys(CA_POLICY_LABEL) as CaPolicyName[]).find((name) => headingKey(CA_POLICY_LABEL[name]) === key);
  if (label && NO_SECTION.has(label)) return null;
  const mapped = label ? (OFFENSE_MANUAL_SECTIONS[label === "attendance" ? "tardiness" : label]?.headings ?? null) : null;
  const section = findManualSection(chunks, mapped ?? [heading], false);
  if (!section || section.foundBy === "contents") return null;
  return Number.isInteger(section.page) && section.page > 0 ? section : null;
}

/** "p.12", "pp.26–27", or null when the app cites no section of the manual for the name. */
export function printedPageLabel(heading: string, chunks: readonly ManualChunk[]): string | null {
  const section = citedSectionFor(heading, chunks);
  if (!section) return null;
  const chunk = chunks.find((item) => item.chunkIndex === section.chunkIndex);
  return pageLabel(section.page, chunk?.locator ?? null, headingKey(section.heading));
}

function pageLabel(page: number, locator: string | null, key: string): string {
  const range = /^Pages\s+(\d+)\s*[–-]\s*(\d+)\s*[—–-]\s*(.+)$/i.exec(locator?.trim() ?? "");
  if (range && Number(range[1]) === page && Number(range[2]) > page && headingKey(range[3]!) === key) {
    return `pp.${page}–${range[2]}`;
  }
  return `p.${page}`;
}

/** "Standards of Conduct (JBA Policy Manual p.12)", or null when the app cites no section for the name. */
export function headingWithPrintedPage(heading: string, chunks: readonly ManualChunk[]): string | null {
  const label = printedPageLabel(heading, chunks);
  return label ? `${heading} (${MANUAL} ${label})` : null;
}

const HAS_PAGE = /\bpp?\.\s*\d|\bpages?\s+\d/i;
const AS_YOU_SAID = /^(\*\*Policy:\*\* )(.+?)(, as you said\b.*)$/;
const BARE = /^(\*\*Policy:\*\* )(.+?)(\.?)$/;
const READS_AS = /^(\*\*Policy:\*\* this reads as \*\*)(.+?)(\*\*)( — .*)$/;

/** The card's own policy lines, each with its printed page where the manual gives one. */
export function withPolicyPagesOnCard(content: string, chunks: readonly ManualChunk[]): string {
  if (chunks.length === 0 || !content.includes("**Policy:**")) return content;
  const lines = content.split("\n").map((line) => {
    if (!line.startsWith("**Policy:** ") || HAS_PAGE.test(line)) return line;
    const reads = READS_AS.exec(line);
    if (reads) {
      const label = ownHeading(reads[2]!) ? printedPageLabel(reads[2]!, chunks) : null;
      return label ? `${reads[1]}${reads[2]}${reads[3]} (${MANUAL} ${label})${reads[4]}` : line;
    }
    const said = AS_YOU_SAID.exec(line) ?? BARE.exec(line);
    if (!said || !ownHeading(said[2]!)) return line;
    const cited = headingWithPrintedPage(said[2]!, chunks);
    return cited ? `${said[1]}${cited}${said[3]}` : line;
  });
  const next = lines.join("\n");
  return next === content ? content : next;
}

function ownHeading(text: string): boolean {
  return CARD_POLICY_HEADINGS.includes(text);
}
