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
 * out with the space before it, a bracket it leaves empty goes too, and the
 * punctuation closes up. A line's indentation, code spans and brackets the
 * text already had are kept (QA-5). The cited excerpts and their cards are unchanged;
 * [p.N] page citations are never touched. Off, the reply as given.
 */

/** One marker, and a run of them joined by nothing, commas, "and", "or" or "&". */
const MARKER = String.raw`\[\s*S\s*\d{1,3}\s*\]`;
const RUN = new RegExp(String.raw`[^\S\n]*${MARKER}(?:[^\S\n]*(?:,|;|&|\band\b|\bor\b)?[^\S\n]*${MARKER})*`, "gi");

/**
 * Code is left as written: a "`arr[S1]`" span, and a fenced ``` block
 * (QA-5, 26 Oct 2026: "config[S1]" inside a fence lost its "[S1]"). A
 * marker inside a quoted phrase ("see [S2]") is still the model's handle,
 * not the manager's words, and is taken out.
 */
const CODE_SPAN = /```[^\n]*\n[\s\S]*?```|`[^`\n]*`/g;

/** The text with every raw [S#] taken out. Indentation, code spans and the brackets the text already had are kept. */
export function withoutRawMarkerText(text: string): string {
  if (!new RegExp(MARKER, "i").test(text)) return text;
  const code: string[] = [];
  const masked = text.replace(CODE_SPAN, (span) => `\u0000${code.push(span) - 1}\u0000`);
  if (!new RegExp(MARKER, "i").test(masked)) return text;
  const cleaned = masked
    .split("\n")
    .map((line) => {
      if (!new RegExp(MARKER, "i").test(line)) return line;
      const indent = /^[^\S\n]*/.exec(line)![0];
      const body = line
        .slice(indent.length)
        // A bracket the removal empties goes with it: "(see [S4], [S5])", "([S2])".
        .replace(new RegExp(String.raw`[^\S\n]*\([^\S\n]*(?:(?:see|per|from|in)[^\S\n]+)?${MARKER}(?:[^\S\n]*(?:,|;|&|\band\b|\bor\b)?[^\S\n]*${MARKER})*[^\S\n]*\)`, "gi"), "")
        .replace(RUN, "")
        .replace(/[^\S\n]+([,.;:!?)])/g, "$1")
        .replace(/,(?=[.;:!?])/g, "")
        .replace(/[^\S\n]{2,}/g, " ")
        .replace(/[^\S\n]+$/, "");
      return indent + body;
    })
    .join("\n");
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => code[Number(index)]!).trim();
}

/** A response whose reply carries no raw [S#]. Off, the response as given. */
export function withoutRawMarkers<T extends { content: string }>(response: T): T {
  if (!rawMarkerBackstopEnabled()) return response;
  const content = withoutRawMarkerText(response.content);
  return content === response.content ? response : { ...response, content };
}
