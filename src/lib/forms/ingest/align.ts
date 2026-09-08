import type { FormBlock, FormDocument, FieldResponsibility, FormField } from "../document";

/**
 * ============================================================================
 * A RE-ISSUED FORM IS THE SAME FORM
 * ============================================================================
 *
 * Extraction produces a document that is CORRECT and ANONYMOUS: the right
 * questions, in the right order, with keys derived from their labels and
 * everything marked "a person fills this". Published as-is against an existing
 * template, that would be a quiet regression on two fronts.
 *
 *   THE ENGINE WOULD STOP FILLING THE HEADER. `createInstance` seeds the
 *   employee, the date, the job title and the salon into four specific keys. A
 *   fresh extraction calling them `name` and `date` renders four blank rules
 *   where a name belongs.
 *
 *   AND EVERY BUSINESS DECISION ABOUT THE FORM WOULD BE LOST. Which fields Ask
 *   Sunny may draft is not a property of the words on the page — it was decided
 *   per field, per form, and it is recorded on the CURRENT version. Extraction
 *   cannot re-derive it from a PDF and must not pretend to.
 *
 * So a proposal is ALIGNED against the version it would replace: where the new
 * document is recognisably the same field, it inherits that field's key and its
 * responsibility. Where it is genuinely new, it keeps its derived key, starts
 * as a person's to fill, and is REPORTED as new so a reviewer looks at it.
 *
 * ============================================================================
 * WHY KEYS ARE WORTH THIS MUCH TROUBLE
 * ============================================================================
 *
 * A key is what a stored answer is filed under. Alignment is not a tidiness
 * exercise: it is what makes "the topics changed" a change to the blank form
 * rather than a change to what a signed one means. Historical records are safe
 * regardless — they render against their own version, which is never edited —
 * but a DRAFT in progress, and every form filled after publication, reads
 * better for having kept the names it had.
 */

export interface AlignmentReport {
  /** Keys carried over from the current version, with what matched them. */
  matched: { key: string; label: string; how: "label" | "options" | "canonical" }[];
  /** Fields the proposal adds. A reviewer should look at each one. */
  added: { key: string; label: string }[];
  /** Fields the current version has and the proposal does not. */
  removed: { key: string; label: string }[];
}

export interface AlignedDocument {
  document: FormDocument;
  report: AlignmentReport;
  warnings: string[];
}

const normalise = (text: string) =>
  text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

interface CurrentField {
  key: string;
  label: string;
  responsibility: FieldResponsibility;
  /** Guidance an author wrote for this field. Not in any source document. */
  help?: string;
  /** Whether this field may only be filled from approved policy. */
  policyGrounded?: boolean;
  /** Whether this field drafts as Observed/Expectation. Also not in a source. */
  narrative?: FormField["narrative"];
}

interface CurrentGroup {
  key: string;
  responsibility: FieldResponsibility;
  optionLabels: Set<string>;
  sectionLabel: string | null;
}

function readCurrent(document: FormDocument) {
  const fields: CurrentField[] = [];
  const groups: CurrentGroup[] = [];
  let brand: string | null = null;
  let section: string | null = null;

  for (const block of document.blocks) {
    if (block.kind === "letterhead") brand = block.brand;
    if (block.kind === "section") section = block.label;
    if (block.kind === "field") {
      fields.push({ ...block.field });
    }
    if (block.kind === "field_row") {
      for (const entry of block.fields) fields.push({ ...entry });
    }
    if (block.kind === "checkbox_group") {
      groups.push({
        key: block.key,
        responsibility: block.responsibility,
        optionLabels: new Set(block.options.map((option) => normalise(option.label))),
        sectionLabel: section,
      });
    }
  }
  return { fields, groups, brand };
}

/**
 * How alike two option lists are, as a fraction of the smaller one.
 *
 * Deliberately NOT Jaccard. The Coaching Form's topics went from ten options to
 * eleven with almost none in common, and that IS the same group — it is the
 * same question, re-answered. What identifies a group across a re-issue is its
 * place in the document, so the option overlap is only ever a tie-breaker and
 * the threshold is high enough that an accidental one-word overlap cannot
 * trigger it.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Aligns a freshly extracted document against the version it would replace.
 *
 * `current` is the published version's document. With none — a template being
 * created rather than re-issued — the proposal is returned untouched, because
 * there is nothing to be consistent with.
 */
export function alignToCurrent(
  proposed: FormDocument,
  current: FormDocument | null,
): AlignedDocument {
  const report: AlignmentReport = { matched: [], added: [], removed: [] };
  const warnings: string[] = [];
  if (!current) {
    return { document: proposed, report, warnings };
  }

  const existing = readCurrent(current);
  const byLabel = new Map(existing.fields.map((entry) => [normalise(entry.label), entry]));
  const byKey = new Map(existing.fields.map((entry) => [entry.key, entry]));
  const claimed = new Set<string>();

  /** Groups still available to match, in document order. */
  const freeGroups = [...existing.groups];
  let section: string | null = null;
  let groupIndex = 0;

  const alignField = (entry: {
    key: string;
    label: string;
    input: "text" | "long_text" | "date";
    responsibility: FieldResponsibility;
  }) => {
    const label = normalise(entry.label);
    const byLabelMatch = byLabel.get(label);
    // The extractor already puts a header line on the engine's own key; that
    // counts as a match against the current version when the key is really there.
    const byKeyMatch = byKey.get(entry.key);

    const match = byLabelMatch ?? byKeyMatch;
    if (match && !claimed.has(match.key)) {
      claimed.add(match.key);
      report.matched.push({
        key: match.key,
        label: entry.label,
        how: byLabelMatch ? "label" : "canonical",
      });
      /*
       * `help` AND `policyGrounded` COME ACROSS WITH THE RESPONSIBILITY.
       *
       * All three are things a PERSON decided about this field and wrote down;
       * none of them is in the Word file or the PDF, and extraction has no way
       * to recover them. Dropping them on a re-issue would quietly delete the
       * guidance a manager reads while filling the form, and — worse — would
       * un-ground the two fields that may only be filled by quoting the policy
       * manual, turning a constrained field into a free one.
       */
      return {
        ...entry,
        key: match.key,
        responsibility: match.responsibility,
        ...(match.help !== undefined ? { help: match.help } : {}),
        ...(match.policyGrounded ? { policyGrounded: true } : {}),
        // `narrative` is authored guidance too — it is what makes a field draft
        // as Observed/Expectation. A source document cannot express it, so a
        // re-issue that dropped it would quietly turn a structured coaching
        // narrative back into a loose paragraph.
        ...(match.narrative ? { narrative: match.narrative } : {}),
      };
    }
    report.added.push({ key: entry.key, label: entry.label });
    return entry;
  };

  const blocks: FormBlock[] = proposed.blocks.map((block): FormBlock => {
    if (block.kind === "section") {
      section = block.label;
      return block;
    }

    if (block.kind === "letterhead") {
      /*
       * THE BRAND IS HOUSE STYLE, NOT DOCUMENT CONTENT. Every form in the
       * library prints the same one, in the same case. The TITLE comes from the
       * source — that is the document's own name — but a PDF that spells the
       * brand "Sun Tan City" must not leave one form shouting less than the
       * other twelve.
       */
      return { ...block, brand: existing.brand ?? block.brand };
    }

    if (block.kind === "field") {
      return { ...block, field: alignField(block.field) };
    }

    if (block.kind === "field_row") {
      return { ...block, fields: block.fields.map(alignField) };
    }

    if (block.kind === "checkbox_group") {
      const proposedLabels = new Set(block.options.map((option) => normalise(option.label)));
      // Same section heading first, then a strong option overlap, then position.
      const bySection = freeGroups.find(
        (group) => group.sectionLabel !== null && normalise(group.sectionLabel) === normalise(section ?? ""),
      );
      const byOptions = freeGroups.find(
        (group) => overlap(group.optionLabels, proposedLabels) >= 0.6,
      );
      const byPosition = freeGroups[0] === undefined ? undefined : freeGroups[groupIndex] ?? undefined;
      const match = bySection ?? byOptions ?? byPosition;
      groupIndex += 1;

      if (match) {
        freeGroups.splice(freeGroups.indexOf(match), 1);
        claimed.add(match.key);
        report.matched.push({
          key: match.key,
          label: section ?? match.key,
          how: bySection ? "label" : byOptions ? "options" : "canonical",
        });
        return { ...block, key: match.key, responsibility: match.responsibility };
      }
      report.added.push({ key: block.key, label: section ?? block.key });
      return block;
    }

    return block;
  });

  for (const entry of existing.fields) {
    if (!claimed.has(entry.key)) {
      report.removed.push({ key: entry.key, label: entry.label });
    }
  }
  for (const group of existing.groups) {
    if (!claimed.has(group.key)) {
      report.removed.push({ key: group.key, label: group.sectionLabel ?? group.key });
    }
  }

  if (report.added.length > 0) {
    warnings.push(
      `New to this form, and starting as "Manager completes": ${report.added
        .map((entry) => entry.label || entry.key)
        .join(", ")}. Set who fills each one before publishing.`,
    );
  }
  if (report.removed.length > 0) {
    warnings.push(
      `On the published form and not in this document: ${report.removed
        .map((entry) => entry.label || entry.key)
        .join(", ")}. Forms already filled keep them; new ones will not have them.`,
    );
  }

  /*
   * THE VISUAL STYLE IS CARRIED FORWARD, for the same reason the help text and
   * the policy grounding are: it is a decision an author made about how this
   * form prints — headings, letterhead, logo, margins — and NOTHING IN A SOURCE
   * DOCUMENT CAN EXPRESS IT. Re-issuing the Coaching Form from the same Word
   * file it was built from would otherwise strip its logo and put the black
   * bars back, silently, on the next publish.
   */
  return {
    document: { paper: "letter", ...(current.style ? { style: current.style } : {}), blocks },
    report,
    warnings,
  };
}
