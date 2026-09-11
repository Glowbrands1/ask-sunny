import { checkboxGroupsForVariant, type FormDocument } from "./document";
import { manualDisplayTitle } from "./official-policy-manual";
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
export function manualReferenceValue(
  grounding: PolicyGrounding,
  officialManualDocumentId?: string | null,
): string | null {
  if (grounding.unverified || grounding.sources.length === 0) return null;

  /*
   * ==========================================================================
   * A REFERENCE MAY ONLY NAME THE OFFICIAL MANUAL
   * ==========================================================================
   *
   * Retrieval for the policy fields searches every category that can carry a
   * rule the company issues — policies, operations, safety, equipment and pay.
   * That is right for finding the PASSAGE that licenses saying a rule was
   * broken, and wrong for naming the document on the line that reads "Direct
   * policy from official manual".
   *
   * MEASURED AGAINST THE LIVE CORPUS, those categories hold twenty equipment
   * troubleshooting guides and three interviewing documents. A form ticked for
   * an offense the manual states no section for would fall through to this
   * function and could put "UV Tanning Bed Troubleshooting" or "Best Practices
   * for Interviewing" on somebody's employment record as the policy they
   * violated. Nobody would read that as anything but a mistake, and it would be
   * a mistake that looks checked.
   *
   * So when the build knows which document is the official manual, only that
   * document may be named here. Everything else resolves to null, the field
   * stays blank, and the manager writes it — the same safe failure the rest of
   * this area is built on. When no manual is identified at all the old
   * behaviour stands, because a deployment with no pinned manual has nothing
   * narrower to offer.
   */
  const eligible = officialManualDocumentId
    ? grounding.sources.filter((source) => source.documentId === officialManualDocumentId)
    : grounding.sources;
  if (eligible.length === 0) return null;

  const best = eligible.reduce((top, source) => (source.score > top.score ? source : top));
  const title = manualDisplayTitle(best.documentTitle);
  if (title === "") return null;

  const locators = [
    ...new Set(
      eligible
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

/**
 * ============================================================================
 * THE HALF OF THAT PAIR THAT COMES OFF THE FORM, NOT OFF A RETRIEVAL
 * ============================================================================
 *
 * `policy_violated` is the offense category the manager TICKED. It is not a
 * claim about a document, so the retrieval gate has nothing to gate: there is
 * no manual it could misquote and no passage it could be checked against.
 *
 * WHY THIS SET EXISTS AT ALL — AND IT IS NOT A STYLE CHOICE. The published
 * version an instance is PINNED TO decides which fields are `policyGrounded`,
 * and instances created before the field was redefined are pinned to a version
 * where `policy_violated` still carried that flag. On those instances the
 * retrieval gate ran over a value derived from the tick box, found no verified
 * grounding behind it, and withheld it — which is exactly the blank line the
 * business reported, on forms that had the offense plainly ticked above it.
 *
 * Re-publishing does not fix them, and must not: a pinned version is immutable
 * by design, and an instance already filed keeps the document it was filed
 * under. So the exemption is asserted HERE, on the meaning of the field, rather
 * than left to whichever version a given instance happens to point at.
 *
 * NOTHING IS WEAKENED BY IT. `policy_language` — the field that NAMES an
 * approved manual — is deliberately absent, so the one value that could
 * misquote a document still passes through the gate, still fails closed, and
 * still holds up finalization without an acknowledgement.
 */
export const FORM_DERIVED_POLICY_KEYS: ReadonlySet<string> = new Set(["policy_violated"]);

/**
 * The provenance a form-derived value carries instead of a retrieval's.
 *
 * It is `verified: true` because the claim it makes is verified — by the form
 * itself, which is what `source: "offense_type"` records. The write-time guard
 * reads `verified`, so a value that skipped the retrieval gate upstream would
 * otherwise be refused at the table by the guard that exists precisely to
 * distrust its callers.
 *
 * `grounded: false` keeps the audit trail honest about WHICH kind of evidence
 * stands behind the value: nobody reading this row should conclude a manual was
 * consulted for it.
 */
export function formDerivedProvenance(
  derived: readonly string[],
): Record<string, Record<string, unknown>> {
  const provenance: Record<string, Record<string, unknown>> = {};

  for (const key of derived) {
    if (!FORM_DERIVED_POLICY_KEYS.has(key)) continue;
    provenance[key] = { grounded: false, derived: true, source: "offense_type", verified: true };
  }

  return provenance;
}

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
  /**
   * The reference built from the PINNED official manual, when its section for
   * the ticked offense was found.
   *
   * PREFERRED OVER THE RETRIEVAL when present, because it is the stronger
   * evidence of the two: the manual is settled by identity rather than by a
   * similarity score, and the section and page come from the sheet's own
   * heading. The retrieval-built reference stays as the fallback for a
   * deployment that has not tagged a manual, and for the Policy Review, which
   * is not pinned to one document.
   */
  readonly manualReference?: string | null;
  /**
   * The pinned official manual's document id, when one was resolved.
   *
   * Narrows the retrieval fallback to that document — see
   * `manualReferenceValue` for the equipment guides this keeps off an
   * employment record.
   */
  readonly officialManualDocumentId?: string | null;
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
  assign(
    "policy_language",
    (input.manualReference ?? "").trim() !== ""
      ? input.manualReference!.trim()
      : manualReferenceValue(input.grounding, input.officialManualDocumentId),
  );

  return { values, derived, unresolved };
}
