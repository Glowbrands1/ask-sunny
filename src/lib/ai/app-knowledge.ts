import type { ManualChunk, PolicyManualIdentity } from "@/lib/forms/official-policy-manual";
import { keywordQuery } from "@/lib/knowledge/hybrid";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * ============================================================================
 * QUESTIONS ABOUT ASK SUNNY ITSELF
 * ============================================================================
 *
 * ASK SUNNY FEEDBACK, 7 OCTOBER 2026, rated one star: "How can I change the
 * password on this platform" was answered "the knowledge base doesn't cover
 * changing your password for Ask Sunny itself". It does — the Ask Sunny app
 * knowledge document has a "Signing in and accounts" section — but "this
 * platform" is not a phrase that document uses, and fourteen similarity slots
 * went to thermostat and email-password pages instead.
 *
 * A question about the app is answered from ONE document, so that document is
 * pinned by identity — tag first, then its file name, then its title — the way
 * the official policy manual and the frameworks already are, and with the same
 * lookup (`resolvePolicyManual`). Only the sections the question touches are
 * pinned, plus the document's own answering rules, so the evidence budget is
 * left to everything else.
 *
 * NOTHING HAPPENS WHEN THE DOCUMENT IS ABSENT. A deployment without one — or a
 * brand whose app document is named differently and not yet tagged — answers
 * exactly as it did before.
 */
export const ASK_SUNNY_APP_KNOWLEDGE: PolicyManualIdentity = {
  id: "ask_sunny_app_knowledge",
  tag: "ask-sunny-app-knowledge",
  fallbackFilenames: ["ask-sunny-app-knowledge"],
  fallbackTitles: ["ask sunny app knowledge"],
  readsContentsPage: false,
};

/**
 * The app named, or referred to as the thing being used right now.
 *
 * ONLY EXPLICIT REFERENCES. "The assistant salon director", "the application
 * for a new hire" and "the tool for spray tan" are not about Ask Sunny, and a
 * bare password question is not either: "how do I reset my email password"
 * belongs to that system's own instructions, and pinning this guide would
 * answer it with Ask Sunny's reset flow. A manager who means Ask Sunny says
 * so — "Ask Sunny", "this app", "this platform", "on here" — as the 1★ feedback did.
 */
const NAMES_THE_APP = [
  /\bask\s*sunny\b/i,
  /\b(?:this|your)\s+(?:app|platform|site|website|web\s*site|chat|chatbot)\b/i,
  /\bon\s+here\b/i,
];

export function asksAboutTheApp(question: string): boolean {
  return NAMES_THE_APP.some((pattern) => pattern.test(question));
}

const MAX_SECTIONS = 3;
const RULES_SECTION = /answering rules/i;

/**
 * The app document's rows this question needs: the sections that share its
 * words, best first by how many, kept in document order, and the document's
 * own answering rules.
 */
export function selectAppKnowledgeRows(input: {
  question: string;
  documentId: string;
  documentTitle: string;
  documentCategory?: string;
  chunks: readonly ManualChunk[];
}): MatchedChunkRow[] {
  /*
   * A WORD MATCHES ITS OWN FAMILY: "change" finds "changed", "passwords"
   * finds "password". The first five letters are enough to tell this
   * document's sections apart, and nothing here leaves the document.
   */
  const stems = keywordQuery(input.question).terms.map((term) => term.slice(0, 5));
  // A row is cited from the database's own id and locator; one without either is not used.
  const usable = input.chunks.filter(
    (chunk): chunk is ManualChunk & { chunkId: string; locator: string } =>
      Boolean(chunk.chunkId && chunk.locator),
  );
  /*
   * WHOLE WORDS, NOT SUBSTRINGS. "tan" inside "important" or "app" inside
   * "approve" scored every section, and the top three were then chosen on
   * noise. A stem matches a word that starts with it; a three-letter term
   * must be the whole word.
   */
  const scored = usable.map((chunk) => {
    const words = new Set(
      `${chunk.section ?? ""} ${chunk.locator} ${chunk.content}`.toLowerCase().match(/[a-z0-9]+/g) ?? [],
    );
    const hits = stems.filter((stem) =>
      stem.length < 4 ? words.has(stem) : [...words].some((word) => word.startsWith(stem)),
    );
    return { chunk, score: hits.length };
  });

  const chosen = new Set(
    scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
      .slice(0, MAX_SECTIONS)
      .map((entry) => entry.chunk.chunkId),
  );
  if (chosen.size === 0) return [];
  for (const chunk of usable) {
    if (RULES_SECTION.test(chunk.locator) || RULES_SECTION.test(chunk.section ?? "")) chosen.add(chunk.chunkId);
  }

  return usable
    .filter((chunk) => chosen.has(chunk.chunkId))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((chunk) => ({
      chunk_id: chunk.chunkId,
      document_id: input.documentId,
      document_title: input.documentTitle,
      category: input.documentCategory ?? "other",
      locator: chunk.locator,
      page: chunk.page,
      section: chunk.section ?? null,
      content: chunk.content,
      // Pinned by identity, never measured — as every pinned row is.
      similarity: 0,
    }));
}
