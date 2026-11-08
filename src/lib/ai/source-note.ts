import { adjacentSourceMarkersEnabled, sourceNoteGuardEnabled } from "@/lib/config/chat-quality-flags";

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

/*
 * SOURCE_NOTE_GUARD_ENABLED, the bare markers (QA's live Sunny tester, 6 Nov 2026): "…need to be
 * documented… [S46]." and "…up to and including termination [S1]." reached the reply. `stripMarkers` runs
 * on the knowledge answer only, and handles one tag, not a group ("[S12, S14]"); a form or Corrective
 * Action reply never passes through it. With the flag on, the final reply on every path loses a bare
 * source tag or a group of them where a sentence goes on or ends. A tag with a page or section
 * ("[S1 p.14]") and any other bracket ("[Employee]") are left alone. Off, the text as it is.
 */
const BARE_MARKERS = /[^\S\n]*\[\s*S\d{1,3}(?:\s*(?:,|;|&|and)\s*S\d{1,3})*\s*\](?=[\s.,;:!?)]|$)/gi;

/*
 * ADJACENT_SOURCE_MARKERS_ENABLED (QA's live Sunny tester after round 4, 8 Nov 2026): "…to see their eyewear [S4][S3]."
 * kept "[S4]": each tag had to be followed by a space or punctuation, and "[S4]" is followed by "[S3]". With this flag
 * on, a run of bare tags side by side ("[S4][S3]", "[S4] [S3]", "[S2, S5][S1]") goes as one. Off, as before.
 */
const BARE_MARKER = String.raw`\[\s*S\d{1,3}(?:\s*(?:,|;|&|and)\s*S\d{1,3})*\s*\]`;
const BARE_MARKER_RUNS = new RegExp(String.raw`[^\S\n]*${BARE_MARKER}(?:[^\S\n]*${BARE_MARKER})*(?=[\s.,;:!?)]|$)`, "gi");

export function withoutSourceMarkers(text: string): string {
  if (!sourceNoteGuardEnabled() || !/\[\s*S\d/i.test(text)) return text;
  const out = text.replace(adjacentSourceMarkersEnabled() ? BARE_MARKER_RUNS : BARE_MARKERS, "");
  return out === text ? text : out.replace(/[^\S\n]+([.,;:!?])/g, "$1");
}

