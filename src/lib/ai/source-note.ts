import { sourceNoteGuardEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A NOTE ABOUT A SOURCE NEVER REACHES THE MANAGER
 * (SOURCE_NOTE_GUARD_ENABLED, QA, 5 Nov 2026; default off)
 * ============================================================================
 *
 * The answering model marks what it took from a source with "[S1]". Once it
 * wrote a note to itself in that bracket instead — "[S1 doesn't actually cover
 * general tardiness — it only covers failing to open the salon…]" — and the
 * manager saw it: `stripMarkers` removes "[S1]" and "[S1][S2]", not a bracket
 * that goes on in prose. With the flag on, a bracket that starts with a source
 * tag ("S" and a number) and goes on in words is removed, with the space
 * before it. Kept, for the marker stripping as before: a bare marker, a group
 * ("[S1, S2]", already read as markers by `normalizeMarkers`), and a tag with
 * only a page or section after it ("[S1 p.14]", "[S2, §3.1]"). A line left
 * empty by the removal is dropped. Off, the text is returned as it is.
 */

/** "[S1 …]": a source tag, then anything up to the closing bracket on the same line. */
const TAGGED_BRACKET = /[^\S\n]*\[\s*S\d{1,2}\b([^\]\n]*)\]/gi;
/** What may follow the tag in a citation: separators, more tags, a page or a section number. */
const CITATION_REST = /^(?:[\s,;&–—-]|and\b|S\d{1,2}\b|p(?:age|p)?\.?\s*\d+(?:\s*[-–]\s*\d+)?|§\s*[\d.]+|sec(?:tion)?\.?\s*[\d.]+)*$/i;

export function withoutSourceNotes(text: string): string {
  if (!sourceNoteGuardEnabled() || !/\[\s*S\d/i.test(text)) return text;
  let removed = false;
  const out = text.replace(TAGGED_BRACKET, (bracket, rest: string) => {
    if (CITATION_REST.test(rest)) return bracket;
    removed = true;
    return "";
  });
  if (!removed) return text;
  return out
    .split("\n")
    .filter((line, index, lines) => line.trim() !== "" || (lines[index - 1] ?? "").trim() !== "")
    .join("\n")
    .replace(/[^\S\n]+([.,;:!?])/g, "$1")
    .trim();
}
