import { manualDisplayTitle, type ManualChunk, type ManualSection } from "./official-policy-manual";

/**
 * ============================================================================
 * "DIRECT POLICY FROM OFFICIAL MANUAL" — the wording, then where it came from
 * ============================================================================
 *
 * A policy-dependent form (the Corrective Action Form and the Policy Review)
 * shows the approved wording a manager is relying on AND a source a person can
 * check it against:
 *
 *   Employees are to keep a neat, clean and professional appearance…
 *
 *   Source: JBA Policy Manual — Dress Code for The Company, p. 15
 *
 * EVERY PART OF THE SOURCE LINE IS COPIED, NEVER COMPOSED. The title is the
 * knowledge document's; the section and page come from the manual's own
 * printed heading (a pinned manual) or from the retrieved chunk's locator.
 * What is not known is left out — "Source: JBA Policy Manual — Attendance"
 * without a page, "Source: STC Dress Code" without either — and nothing is
 * filled in to make the line look complete.
 *
 * INTERNAL LABELS ARE NOT SECTIONS. A plain-text document's chunks are
 * labelled "Text" (and a Word document without headings "Document body") by
 * the extractor. Those name how the file was read, not a place in the policy,
 * and are dropped — which is how "Shift Replacement — Text" reached a live
 * form.
 */

export interface GroundedPolicy {
  /** The approved wording, verbatim from the knowledge base. */
  readonly policyText: string;
  /** The document's human-readable title. */
  readonly documentTitle: string;
  readonly sectionTitle: string | null;
  /** The page the document PRINTS ("15", "15–16"), when known. */
  readonly pageLabel: string | null;
  readonly documentId: string;
  readonly source: "official_policy_manual" | "knowledge_retrieval";
}

/** Extractor labels that say how a file was read, not where in it a passage sits. */
const GENERIC_LOCATORS = /^(?:text|document body|body|content|document)$/i;

/**
 * The page and section a chunk locator states, and nothing it does not.
 *
 *   "Page 15 — Dress Code for The Company"  → 15, "Dress Code for The Company"
 *   "Pages 15–16 — Hair"                    → "15–16", "Hair"
 *   "Page 3"                                → 3, none
 *   "Confidentiality"                       → none, "Confidentiality"
 *   "Text"                                  → none, none
 */
export function locatorParts(locator: string | null | undefined): { pageLabel: string | null; sectionTitle: string | null } {
  const text = (locator ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || GENERIC_LOCATORS.test(text)) return { pageLabel: null, sectionTitle: null };
  const paged = /^pages?\s+(\d+(?:\s*[–-]\s*\d+)?)(?:\s*[—–-]\s*(.+))?$/i.exec(text);
  if (paged) {
    const section = (paged[2] ?? "").trim();
    return {
      pageLabel: paged[1]!.replace(/\s*[–-]\s*/, "–"),
      sectionTitle: section === "" || GENERIC_LOCATORS.test(section) ? null : section,
    };
  }
  return { pageLabel: null, sectionTitle: text };
}

/** `Source: <title> — <section>, p. <page>`, with only the parts that are known. */
export function sourceLine(policy: Pick<GroundedPolicy, "documentTitle" | "sectionTitle" | "pageLabel">): string {
  const title = policy.documentTitle.trim();
  const section = policy.sectionTitle?.trim() ? ` — ${policy.sectionTitle.trim()}` : "";
  const page = policy.pageLabel?.trim() ? `, ${policy.pageLabel.includes("–") ? "pp." : "p."} ${policy.pageLabel.trim()}` : "";
  return `Source: ${title}${section}${page}`;
}

/** The field's value: each passage's wording, then its source. */
export function policyFieldValue(policies: readonly GroundedPolicy[]): string | null {
  const blocks = policies
    .filter((p) => p.documentTitle.trim() !== "")
    .map((p) => (p.policyText.trim() ? `${p.policyText.trim()}\n\n${sourceLine(p)}` : sourceLine(p)));
  return blocks.length === 0 ? null : blocks.join("\n\n");
}

const EXCERPT_CHARS = 700;

/**
 * A retrieved chunk's wording without its sheet furniture: a leading printed
 * page marker ("15 | P a g e") and a leading repeat of the section heading.
 * Nothing else is touched.
 */
export function passageWording(text: string, sectionTitle: string | null): string {
  let body = text.replace(/^\s*\d+\s*\|\s*p\s*a\s*g\s*e\s*\n/i, "");
  if (sectionTitle) {
    const words = sectionTitle.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    body = body.replace(new RegExp(`^\\s*${words.join("\\s+")}\\s*\\n`, "i"), "");
  }
  return verbatimExcerpt(body);
}

/** Up to `max` characters, ending at a sentence where one ends in range, verbatim otherwise. */
export function verbatimExcerpt(text: string, max = EXCERPT_CHARS): string {
  const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return sentence > max * 0.4 ? cut.slice(0, sentence + 1) : `${cut.trimEnd()}…`;
}

/**
 * The manual's own wording for a section: the chunk that carries its heading,
 * from the heading on. Verbatim; only trimmed to a readable length.
 */
export function sectionWording(chunks: readonly ManualChunk[], section: ManualSection): string {
  const chunk = chunks.find((c) => c.chunkIndex === section.chunkIndex);
  if (!chunk) return "";
  const content = chunk.content;
  const lower = content.toLowerCase();
  /* The heading as printed may wrap across lines: matched word by word, whitespace-insensitively. */
  const words = section.heading.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const found = words.length > 0 ? new RegExp(words.join("\\s+"), "i").exec(content) : null;
  const start = found ? found.index + found[0].length : 0;
  /* Stop at the next heading the manual prints in the same chunk: one section's wording, not the page's. */
  const next = (chunk.sections ?? [])
    .map((s) => s.heading.trim())
    .filter((h) => h !== "" && h.toLowerCase() !== section.heading.toLowerCase())
    .map((h) => lower.indexOf(h.toLowerCase(), start))
    .filter((i) => i > start)
    .reduce((min, i) => Math.min(min, i), content.length);
  return verbatimExcerpt(content.slice(start, next).replace(/^[\s:–—-]+/, ""));
}

/** The pinned manual's sections as grounded policies: wording, title, section, printed page. */
export function manualGroundedPolicies(manual: { documentId: string; documentTitle: string; chunks: readonly ManualChunk[] }, sections: readonly ManualSection[]): GroundedPolicy[] {
  const seen = new Set<string>();
  return sections
    .filter((section) => (seen.has(section.heading) ? false : (seen.add(section.heading), true)))
    .map((section) => ({
      policyText: sectionWording(manual.chunks, section),
      documentTitle: manualDisplayTitle(manual.documentTitle),
      sectionTitle: section.heading,
      pageLabel: Number.isFinite(section.page) && section.page > 0 ? String(section.page) : null,
      documentId: manual.documentId,
      source: "official_policy_manual" as const,
    }));
}
