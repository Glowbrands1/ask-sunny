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
 * The cited heading's text: a heading printed as a list ("All Locations Dress Code:", ending in ":") runs from the heading
 * through the following chunks of its sub-items until the manual starts its next titled section (a line ending in ":", as
 * "Crunch Fitness Specific Dress Code:"). A plain heading ("Attendance") ends where the manual's next heading starts: in
 * its chunk, or after the chunks that continue it with no heading of their own (QA2, 21 Nov 2026: lateness under
 * Attendance quoted the Late Opening paragraph, chunk 42). Grammar words never make a block fit (`GRAMMAR`). It is split into its blocks (a sub-heading and
 * its bullets), and the block that shares the most words with the card's account is quoted, verbatim. Shared words are
 * read from the two texts themselves (words of four letters or more, by their first five letters; the employee's name
 * is not counted): no word list. When no block shares a word, the manual's own general rule printed above the heading on
 * that page is quoted (for the dress code: "… neat, clean, professional appearance … proper work attire …"), never an
 * unrelated sub-item. With neither, null (the wording is left as it was). Pure.
 */

const MAX_CHUNKS = 6;
/** As long as `verbatimExcerpt` quotes; a longer list block is narrowed to its item. */
const EXCERPT_LIMIT = 700;
const TITLED_SECTION = /^[^\n:]{3,80}:\s*$/m;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * QA2 (21 Nov 2026, the second #1146 case): "on the phone while a guest waited" matched a Standards of Conduct list block on
 * "while" alone. Grammar words carry no subject, so they never make a block fit. English function words only, by their
 * first five letters as the stems are; no word about the offense or the manager's meaning is here.
 */
const GRAMMAR = new Set(
  ["about", "after", "again", "also", "been", "before", "being", "both", "could", "does", "doing", "down", "during", "each", "even", "every", "from", "have", "having", "here", "into", "just", "like", "more", "most", "much", "must", "only", "other", "over", "same", "should", "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through", "under", "until", "upon", "very", "were", "what", "when", "where", "which", "while", "will", "with", "within", "without", "would", "your"].map((word) => word.slice(0, 5)),
);

function stems(text: string, skip: ReadonlySet<string>): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((word) => word.slice(0, 5)).filter((stem) => !skip.has(stem) && !GRAMMAR.has(stem)),
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
  const after = heading.index + heading[0].length;
  /* A list heading ends in ":" as printed; only it runs on into the chunks of its sub-items. */
  const list = heading[0].includes(":");
  if (!list) {
    const lower = first.content.toLowerCase();
    const next = (first.sections ?? [])
      .map((entry) => entry.heading.trim())
      .filter((other) => other !== "" && other.toLowerCase() !== section.heading.trim().toLowerCase())
      .map((other) => lower.indexOf(other.toLowerCase(), after))
      .filter((index) => index >= after)
      .reduce((min, index) => Math.min(min, index), first.content.length);
    const own = [first.content.slice(after, next)];
    /*
     * With no next heading in its chunk, the section runs on through the chunks that are its continuation (no heading of
     * their own: Standards of Conduct's list, chunks 37-39) and stops at the first chunk that starts a heading (Late Opening).
     */
    if (next === first.content.length) {
      for (const chunk of ordered.slice(at + 1, at + MAX_CHUNKS)) {
        if ((chunk.sections ?? []).some((entry) => entry.heading.trim() !== "")) break;
        own.push(chunk.content);
      }
    }
    return pick(own, general, first, account, employeeName);
  }
  const parts = [first.content.slice(after)];
  for (const chunk of ordered.slice(at + 1, at + MAX_CHUNKS)) {
    const titled = TITLED_SECTION.exec(chunk.content);
    if (titled) {
      parts.push(chunk.content.slice(0, titled.index));
      break;
    }
    parts.push(chunk.content);
  }
  return pick(parts, general, first, account, employeeName);
}

/** The block of `parts` that shares the most words with the account; else the general rule above the heading; else null. */
function pick(parts: readonly string[], general: string, first: ManualChunk, account: string, employeeName?: string | null): string | null {
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
  if (best) {
    /*
     * A list block longer than an excerpt (Standards of Conduct's infractions, one chunk of them) would be cut before the
     * item that fits: the item ("o Insubordination -the refusal to follow the directions of the manager.") is quoted.
     * The text before the first item is an item too (Attendance's opening rule), so a block whose fit is there keeps it.
     */
    const block = best.block;
    if (block.length <= EXCERPT_LIMIT) return verbatimExcerpt(block);
    const items = block.split(/\s+(?=o\s+[A-Z])/).map((item) => item.trim()).filter(Boolean);
    let item: { text: string; score: number } | null = null;
    for (const text of items) {
      const score = [...stems(text, skip)].filter((stem) => said.has(stem)).length;
      if (score > 0 && (item === null || score > item.score)) item = { text, score };
    }
    return verbatimExcerpt(item?.text ?? block);
  }
  /* The general rule above the heading, without its own title line. */
  const titles = new Set((first.sections ?? []).map((entry) => entry.heading.trim().toLowerCase()));
  const lines = general.trim().split("\n");
  if (lines.length > 0 && titles.has(lines[0]!.replace(/:\s*$/, "").trim().toLowerCase())) lines.shift();
  const rule = lines.join("\n").trim();
  return rule.length > 40 ? verbatimExcerpt(rule) : null;
}
