import { checkboxGroupsForVariant, type FormDocument } from "./document";
import type { PolicyGrounding } from "./policy-grounding";

/**
 * ============================================================================
 * THE TWO POLICY FIELDS ARE DERIVED, NOT COMPOSED
 * ============================================================================
 *
 * The business settled what these two fields mean on their form, and the
 * settlement is what makes them safe to fill automatically:
 *
 *   POLICY VIOLATED   the offense CATEGORY — whichever box is ticked under
 *                     Type of Offense. It is a classification the manager
 *                     makes on the form, so copying it down is a restatement
 *                     of something already on the page rather than a claim
 *                     about a document.
 *
 *   DIRECT POLICY     the approved manual the category was checked against,
 *                     named with its section and page. Built from what
 *                     retrieval actually returned, so it can only ever name a
 *                     document that was really read.
 *
 * ============================================================================
 * WHY THIS IS A FUNCTION AND NOT A PROMPT INSTRUCTION
 * ============================================================================
 *
 * Both values are now facts the SERVER already holds — a ticked option key and
 * a retrieved document's title — and asking a model to restate a fact it was
 * handed is how the fact acquires variations. QA watched exactly that: told to
 * fill Policy Violated, the model produced a plausible-sounding policy title
 * that matched no manual, and a placeholder where the quotation belonged.
 *
 * Deriving them removes the question. There is no wording for a model to get
 * wrong, no retrieval to paraphrase, and no way for Policy Violated to
 * disagree with the box printed immediately above it.
 *
 * WHAT IS STILL REFUSED. `policy_language` remains `policyGrounded`, so when
 * retrieval finds nothing it stays empty, the manager is told, and finalizing
 * asks for an acknowledgement. Naming the manual is only possible because a
 * manual answered.
 */

/**
 * The offense category, as the manager ticked it.
 *
 * READS THE STORED DOCUMENT for its labels rather than a list here, so a
 * re-published version that rewords "Dress Code Violation" is followed without
 * an edit. Several ticks are joined; the "other" write-in is preferred over the
 * bare word "Other", which names nothing on its own.
 */
export function offenseCategoryValue(input: {
  readonly document: FormDocument;
  readonly variantKey: string | null;
  readonly checked: Record<string, string[]>;
  readonly values: Record<string, string>;
}): string | null {
  const group = checkboxGroupsForVariant(input.document, input.variantKey).find(
    (candidate) => candidate.key === "offense_type",
  );
  if (!group) return null;

  const ticked = input.checked.offense_type ?? [];
  if (ticked.length === 0) return null;

  const labels = ticked
    .map((key) => {
      if (key === "other") {
        const written = (input.values.other_offense ?? "").trim();
        return written === "" ? null : written;
      }
      return group.options.find((option) => option.key === key)?.label ?? null;
    })
    .filter((label): label is string => label !== null && label !== "");

  return labels.length === 0 ? null : labels.join(", ");
}

/**
 * The approved manual, named with its section and page.
 *
 * ONE DOCUMENT, THE BEST-SCORING ONE. Retrieval returns up to four passages
 * and they are frequently the same manual at different sections; listing all
 * four would put a bibliography in a field that asks for a reference. The
 * locators of every passage from that same document are joined instead, so a
 * hit that spans two sections says so.
 *
 * Returns null when the grounding is unverified — which is what keeps the
 * field empty, the notice honest, and the finalize acknowledgement in force.
 */
export function manualReferenceValue(grounding: PolicyGrounding): string | null {
  if (grounding.unverified || grounding.sources.length === 0) return null;

  const best = grounding.sources.reduce((top, source) =>
    source.score > top.score ? source : top,
  );
  const title = best.documentTitle.trim();
  if (title === "") return null;

  const locators = [
    ...new Set(
      grounding.sources
        .filter((source) => source.documentId === best.documentId)
        .map((source) => source.locator.trim())
        .filter((locator) => locator !== ""),
    ),
  ];

  return locators.length === 0 ? title : `${title} — ${locators.join("; ")}`;
}

/**
 * The two fields nothing the model writes can reach.
 *
 * Exported so the guards that clean MODEL prose can skip them: running a
 * finding or requirement check over a value that is about to be overwritten
 * only produces misleading noise in the response.
 */
export const DERIVED_POLICY_FIELD_KEYS: ReadonlySet<string> = new Set([
  "policy_violated",
  "policy_language",
]);

export interface DerivedPolicyFields {
  readonly values: Record<string, string>;
  /** Which of the two this call actually set, for the response and the trail. */
  readonly derived: string[];
  /**
   * Fields this version has that could not be derived — no box ticked, or no
   * approved policy retrieved. Reported so the response still says a field was
   * wanted and left empty, rather than going quiet about it.
   */
  readonly unresolved: string[];
}

/**
 * Puts both derived values in place of whatever the model wrote.
 *
 * OVERRIDES RATHER THAN FILLS A GAP. A model that produced a policy title of
 * its own is exactly the case this exists for, so its value is replaced, not
 * merely defaulted around. Where a value cannot be derived — no box ticked, or
 * no approved policy retrieved — the field is REMOVED, so the manager gets a
 * blank line rather than the model's guess.
 */
export function applyDerivedPolicyFields(input: {
  readonly document: FormDocument;
  readonly variantKey: string | null;
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
  readonly grounding: PolicyGrounding;
  /** Field keys this version actually has, so nothing is invented onto a form. */
  readonly fieldKeys: ReadonlySet<string>;
}): DerivedPolicyFields {
  const values = { ...input.values };
  const derived: string[] = [];
  const unresolved: string[] = [];

  const assign = (key: string, value: string | null) => {
    if (!input.fieldKeys.has(key)) return;
    if (value === null) {
      delete values[key];
      unresolved.push(key);
      return;
    }
    values[key] = value;
    derived.push(key);
  };

  assign(
    "policy_violated",
    offenseCategoryValue({
      document: input.document,
      variantKey: input.variantKey,
      checked: input.checked,
      values: input.values,
    }),
  );
  assign("policy_language", manualReferenceValue(input.grounding));

  return { values, derived, unresolved };
}
