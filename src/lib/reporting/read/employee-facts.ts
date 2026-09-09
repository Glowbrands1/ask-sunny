import "server-only";

/**
 * ============================================================================
 * CURRENT EMPLOYEE-LEVEL FACTS
 * ============================================================================
 *
 * The Employee Performance Framework is REASONING. It says how to turn an
 * employee's metrics into a coaching priority, a recognition, an observation or
 * an escalation. It supplies no facts about any actual person, and it says so
 * itself: its examples are placeholders, and it forbids reusing historical
 * names, salons, dates, rankings or values as current employee truth.
 *
 * The facts have to come from somewhere else, and the specification names four
 * sources: an ingested employee performance report, a current reporting
 * dataset, facts the manager states, and other authoritative system data.
 *
 * ============================================================================
 * TWO DIFFERENT ABSENCES, AND CONFLATING THEM WAS A BUG
 * ============================================================================
 *
 * The first version of this returned a single `available: false` and the prompt
 * turned that into "YOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA FOR THIS QUESTION".
 * That sentence is false in a common and important case:
 *
 *   "Sarah had 40 opportunities and converted 8 this month. What should I
 *    coach?"
 *
 * The manager just supplied current employee facts. Telling the model it has
 * none makes it either ignore what it was told or contradict the person who
 * said it. Both are worse than saying nothing.
 *
 * So the two absences are now distinct:
 *
 *   `datasetIngested: false`  no employee performance report has been ingested.
 *                            Verified: the reporting layer holds Comp Sales,
 *                            Sales Totals, Bed Usage, Spa Wellness and Spa
 *                            Engagement, all SALON-level, and the schema has no
 *                            employee, staff, consultant or associate table at
 *                            all. So this is false today, always.
 *
 *   NO FACTS AT ALL           a judgement the prompt makes per turn, because
 *                            only the model can see whether the manager stated
 *                            any figures in the conversation. This module does
 *                            not guess at that — parsing numbers out of prose
 *                            and calling them facts is exactly the invention
 *                            the framework forbids.
 *
 * ============================================================================
 * THE BLOCK IS A REAL PATH, NOT A FLAG
 * ============================================================================
 *
 * When an employee dataset does land, `block` carries its rendered figures and
 * `answerQuestion` passes it to Claude as its OWN context section — separate
 * from company knowledge, separate from framework reasoning, separate from the
 * salon-level report briefing. Four sources with four different citation rules;
 * merging any two of them is how a coaching guideline starts being quoted as a
 * measurement.
 *
 * NO MANUFACTURED CITATIONS. Employee facts are not knowledge chunks and get no
 * `[S1]` marker. `provenance` carries whatever the ingested report genuinely
 * recorded — its name and reporting period — and nothing more; when there is no
 * report there is no provenance, rather than a plausible-looking one.
 *
 * DO NOT make this synthesise, estimate or infer employee figures from the
 * salon-level reports. A salon's spa conversion is not an employee's, and
 * dividing one by a headcount is an invention with a number attached.
 */

export interface EmployeeFactsAvailability {
  /**
   * Whether an employee-level performance dataset exists in the system.
   *
   * Distinct from `available`: a dataset can exist and hold nothing for the
   * period in question.
   */
  readonly datasetIngested: boolean;
  /** Whether a facts block is attached to this turn. */
  readonly available: boolean;
  /**
   * The rendered facts for the prompt, or null.
   * Never a placeholder, never a partial, never an estimate.
   */
  readonly block: string | null;
  /**
   * Real provenance for the facts — report name and reporting period — or null.
   * Never fabricated to make an answer look sourced.
   */
  readonly provenance: string | null;
  /** Why there are no ingested facts, for the audit trail and the operator. */
  readonly reason: string | null;
}

export const NO_EMPLOYEE_DATASET_REASON =
  "No employee-level performance dataset has been ingested. The reporting layer holds salon-level data only.";

/** The heading of the employee facts context block, when there is one. */
export const EMPLOYEE_DATA_HEADING = "CURRENT EMPLOYEE PERFORMANCE DATA";

/**
 * Renders an employee facts block for the prompt.
 *
 * Exported so the shape is fixed in one place and the wiring can be tested
 * without an ingested dataset to hand.
 */
export function renderEmployeeFactsBlock(input: {
  readonly facts: string;
  readonly provenance: string | null;
}): string {
  const source = input.provenance
    ? `Source: ${input.provenance}.`
    : "Source: stated by the manager in this conversation.";

  return `${EMPLOYEE_DATA_HEADING}

${source} These are measurements about named people, not policy. Never mark them with a source marker. Use only the figures written here — do not compute a rate the data does not state, and do not fill a gap from the framework's examples.

${input.facts}`;
}

/**
 * Reads the current employee-level performance facts.
 *
 * Never rejects and never throws: an employee-performance question must still
 * get the framework and an honest account of what figures exist, so a failure
 * here degrades to "no ingested facts" by construction rather than taking the
 * answer down with it.
 */
export async function loadEmployeeFacts(): Promise<EmployeeFactsAvailability> {
  return {
    datasetIngested: false,
    available: false,
    block: null,
    provenance: null,
    reason: NO_EMPLOYEE_DATASET_REASON,
  };
}
