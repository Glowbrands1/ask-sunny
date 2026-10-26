import { rawMarkerBackstopEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A RAW SOURCE MARKER NEVER REACHES THE MANAGER (RAW_MARKER_BACKSTOP_ENABLED)
 * ============================================================================
 *
 * QA live, 26 Oct 2026: "[S2]" (conv_mvomnj3mga16lj, S15b), "[S7]" (S26) and
 * "[S6][S10]" (E1, a PTO answer) were printed in replies. The [S#] markers
 * are the model's handles for retrieved excerpts; they become source cards
 * and are taken out of the prose. Two runs got through: a run of markers
 * with nothing between them ("[S4][S6][S1]") lost only its last one, and a
 * pass after the first strip (the reply check) can write one back.
 *
 * Last, on the finished reply: every [S#] left, alone or in a run, is taken
 * out with the space before it, an empty "()" it leaves goes too, and the
 * punctuation closes up. The cited excerpts and their cards are unchanged;
 * [p.N] page citations are never touched. Off, the reply as given.
 */

/** One marker, and a run of them joined by nothing, commas, "and", "or" or "&". */
const MARKER = String.raw`\[\s*S\s*\d{1,3}\s*\]`;
const RUN = new RegExp(String.raw`[^\S\n]*${MARKER}(?:[^\S\n]*(?:,|;|&|\band\b|\bor\b)?[^\S\n]*${MARKER})*`, "gi");

/** The text with every raw [S#] taken out. */
export function withoutRawMarkerText(text: string): string {
  if (!new RegExp(MARKER, "i").test(text)) return text;
  return text
    .replace(RUN, "")
    .replace(/\([^\S\n]*(?:see|per|from|in)?[^\S\n]*\)/gi, "")
    .replace(/[^\S\n]+([,.;:!?)])/g, "$1")
    .replace(/,(?=[.;:!?])/g, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/, ""))
    .join("\n")
    .trim();
}

/** A response whose reply carries no raw [S#]. Off, the response as given. */
export function withoutRawMarkers<T extends { content: string }>(response: T): T {
  if (!rawMarkerBackstopEnabled()) return response;
  const content = withoutRawMarkerText(response.content);
  return content === response.content ? response : { ...response, content };
}
