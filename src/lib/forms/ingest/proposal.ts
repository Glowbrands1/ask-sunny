import type { SourceFormat } from "../source-format";

/**
 * WHAT A DRAFT KNOWS ABOUT WHERE IT CAME FROM.
 *
 * A proposal is not a new kind of record — it is an ORDINARY DRAFT VERSION with
 * this stamped on it. That was the whole point of looking for the seam before
 * building one: the engine already has draft → review → publish, already
 * refuses to edit a published version, already archives the version being
 * replaced. A parallel "proposal" table would have had to re-earn every one of
 * those guarantees.
 *
 * So this says which upload a draft was extracted from and what the extractor
 * was unsure about, and the existing publish path does the rest.
 */
export interface FormProposal {
  /** The stored asset this was read out of. */
  assetId: string;
  fileName: string;
  format: SourceFormat;
  extractedAt: string;
  extractedBy: string;
  /** Told to the reviewer before they publish. Never a reason to block. */
  warnings: string[];
  /** Lines no rule and no refinement could place. Left out of the form. */
  unresolved: { index: number; text: string; reason: string }[];
  /** What matched the published version, what is new, what is gone. */
  alignment: {
    matched: { key: string; label: string; how: string }[];
    added: { key: string; label: string }[];
    removed: { key: string; label: string }[];
  };
  /** Counts a reviewer can scan: blocks, fields, groups, signatures. */
  stats: { blocks: number; fields: number; groups: number; signatures: number };
}

export function isFormProposal(value: unknown): value is FormProposal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FormProposal>;
  return typeof candidate.assetId === "string" && typeof candidate.extractedAt === "string";
}

/** Reads a stored proposal back, tolerating a row that has none. */
export function readProposal(value: unknown): FormProposal | null {
  return isFormProposal(value) ? value : null;
}

/**
 * Whether a proposal still needs somebody to look at it.
 *
 * Anything the extractor was unsure about, or any field it could not match to
 * the published form. A clean proposal is still reviewed — publication is
 * always a person's click — but this is what the card badge says.
 */
export function proposalNeedsAttention(proposal: FormProposal): boolean {
  return (
    proposal.warnings.length > 0 ||
    proposal.unresolved.length > 0 ||
    proposal.alignment.added.length > 0 ||
    proposal.alignment.removed.length > 0
  );
}
