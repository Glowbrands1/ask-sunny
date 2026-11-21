import type { ManualChunk } from "./official-policy-manual";
import { verbatimExcerpt } from "./policy-citation";

/**
 * ============================================================================
 * DIRECT POLICY QUOTES THE PASSAGE OF THE CITED HEADING THAT FITS THE ACCOUNT
 * ============================================================================
 *
 * QA's live check (20 Nov 2026, item 16; the Test Testy draft): a loop card citing "All Locations Dress Code" p.15 for a
 * mini-skirt account saved Direct policy as the NAME TAGS paragraph. The section's wording was read from its heading on,
 * and the first thing under "All Locations Dress Code:" is "Name tags".
 *
 * The cited heading's text runs from the heading through the following chunks until the manual starts its next titled
 * section (a line ending in ":", as "Crunch Fitness Specific Dress Code:"). It is split into its blocks (a sub-heading and
 * its bullets), and the block that shares the most words with the card's account is quoted, verbatim. Shared words are
 * read from the two texts themselves (words of four letters or more, by their first five letters; the employee's name
 * is not counted): no word list. When no block shares a word, the manual's own general rule printed above the heading on
 * that page is quoted (for the dress code: "… neat, clean, professional appearance … proper work attire …"), never an
 * unrelated sub-item. With neither, null (the wording is left as it was). Pure.
 */

const MAX_CHUNKS = 6;
const TITLED_SECTION = /^[^\n:]{3,80}:\s*$/m;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stems(text: string, skip: ReadonlySet<string>): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((word) => word.slice(0, 5)).filter((stem) => !skip.has(stem)),
  );
}

export function accountPassage(
  chunks: readonly ManualChunk[],
  section: { readonly heading: string; readonly chunkIndex: number },
  account: string,
  employeeName?: string | null,
): string | null {
  if (account.trim() === "") return null;
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const at = ordered.findIndex((chunk) => chunk.chunkIndex === section.chunkIndex);
  if (at < 0) return null;
  const first = ordered[at]!;
  const heading = new RegExp(`${section.heading.trim().split(/\s+/).map(escaped).join("\\s+")}[ \\t]*:?[ \\t]*\\n?`, "i").exec(first.content);
  if (!heading) return null;
  const general = first.content.slice(0, heading.index);
  const parts = [first.content.slice(heading.index + heading[0].length)];
  for (const chunk of ordered.slice(at + 1, at + MAX_CHUNKS)) {
    const titled = TITLED_SECTION.exec(chunk.content);
    if (titled) {
      parts.push(chunk.content.slice(0, titled.index));
      break;
    }
    parts.push(chunk.content);
  }
  const skip = stems(employeeName ?? "", new Set());
  const said = stems(account, skip);
  const blocks = parts
    .join("\n\n")
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block.includes("\n") || block.length > 40);
  let best: { block: string; score: number } | null = null;
  for (const block of blocks) {
    const score = [...stems(block, skip)].filter((stem) => said.has(stem)).length;
    if (score > 0 && (best === null || score > best.score)) best = { block, score };
  }
  if (best) return verbatimExcerpt(best.block);
  /* The general rule above the heading, without its own title line. */
  const titles = new Set((first.sections ?? []).map((entry) => entry.heading.trim().toLowerCase()));
  const lines = general.trim().split("\n");
  if (lines.length > 0 && titles.has(lines[0]!.replace(/:\s*$/, "").trim().toLowerCase())) lines.shift();
  const rule = lines.join("\n").trim();
  return rule.length > 40 ? verbatimExcerpt(rule) : null;
}
