import { fullManualKeepsRetrievalEnabled } from "@/lib/config/chat-quality-flags";

import { EXCLUDED_BRAND, FULL_MANUAL_GROUNDING_NOTE, isPolicyManualTitle } from "./full-manual-context";
import type { GroundingChunk } from "./prompts";

/**
 * ============================================================================
 * THE WHOLE POLICY MANUAL, AND THE OTHER DOCUMENTS BESIDE IT
 * ============================================================================
 *
 * FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED (QA, 10 Nov 2026; default off). With FULL_MANUAL_CONTEXT on (production), a turn the
 * normalizer labels "policy" was answered from the JBA Policy Manual alone: `server-ask.ts` set the retrieved rows to none.
 * The manual has no spray tan cleaning or reset steps, so the tester's three questions (conv_mwb2gsx52k6reh7,
 * conv_mwb2hmb62lroh57, conv_mwb2iugw2fxzr9z, 10 Nov 2026 19:12–19:13Z) got "I don't have that" and "I don't have a Tanning
 * Consultant Manual in the knowledge base", although the TC Tanning Consultant Manual is indexed and the same pages were
 * found in other chats that day. Whether a turn took that path rested on the normalizer's label (a model call) and on an
 * incidental word ("press Start Session" reads as a form command), so it looked like variance.
 *
 * On: retrieval still runs. The policy manual's own rows are left out (the whole manual is already in the prompt, and
 * pinning its sections again would bring back [S#] chunks of it), and so are other brands' documents. The rest is given
 * beside the manual as [S#] sources, the shape Ask Bubbles already uses. Off: nothing here is called.
 */

/** Whether this full-manual turn also searches the knowledge base. */
export function fullManualKeepsRetrieval(fullManualBlock: string | null): boolean {
  return fullManualBlock !== null && fullManualKeepsRetrievalEnabled();
}

/** The retrieved rows that go beside the manual: not the policy manual itself, not another brand's document. */
export function besideManualRows<Row extends { readonly document_title: string }>(rows: readonly Row[]): Row[] {
  return rows.filter((row) => !isPolicyManualTitle(row.document_title) && !EXCLUDED_BRAND.test(row.document_title));
}

/** What the prompt says about the manual and the other documents, when the excerpts are given beside it. */
export const FULL_MANUAL_BESIDE_NOTE = `${FULL_MANUAL_GROUNDING_NOTE.replace(" Do not use an [S#] marker.", "")}

OTHER COMPANY DOCUMENTS

Below the manual are excerpts from other company documents (training manuals, guides, equipment instructions), marked [S#]. They are not the policy manual. When the question is about a procedure, a product or equipment they cover, answer from them and end each statement taken from one with its [S#] marker. Cite the policy manual only with its [p.n] marker, never with an [S#] marker.`;

/**
 * The grounding block for a full-manual turn that kept retrieval. `aside` is the coaching-framework block the turn already
 * builds (empty when there is none). `beside` are the excerpts, numbered with the markers the citations resolve.
 */
export function besideManualGrounding(input: { readonly aside: string; readonly beside: readonly GroundingChunk[] }): string {
  const excerpts = input.beside
    .map((chunk) => `[S${chunk.marker}] ${chunk.documentTitle}${chunk.locator ? ` — ${chunk.locator}` : ""}\n${chunk.content}`)
    .join("\n\n---\n\n");
  const note =
    input.beside.length > 0
      ? `${FULL_MANUAL_BESIDE_NOTE}\n\nValid markers are ${input.beside.map((chunk) => `[S${chunk.marker}]`).join(", ")}.\n\n${excerpts}`
      : FULL_MANUAL_GROUNDING_NOTE;
  return [note, input.aside].filter((part) => part.length > 0).join("\n\n");
}
