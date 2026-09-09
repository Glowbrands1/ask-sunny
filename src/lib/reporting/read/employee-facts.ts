import "server-only";

/**
 * ============================================================================
 * CURRENT EMPLOYEE-LEVEL FACTS — THE SEAM, AND WHY IT IS EMPTY
 * ============================================================================
 *
 * The Employee Performance Framework is REASONING. It says how to turn an
 * employee's metrics into a coaching priority, a recognition, an observation or
 * an escalation. It supplies no facts about any actual person, and it says so
 * itself: its examples are placeholders, and it forbids reusing historical
 * names, salons, dates, rankings or values as current employee truth.
 *
 * The facts have to come from somewhere else. THEY DO NOT YET EXIST IN THIS
 * APPLICATION, and this module exists to say that in one place rather than
 * leaving every caller to assume.
 *
 * What the reporting layer actually holds, verified against the live project:
 * Comp Sales, Sales Totals, Bed Usage, Spa Wellness and Spa Engagement — all of
 * them SALON-level. There is no employee, staff, consultant or associate table
 * in the schema at all, and no ingested per-person dataset. So there is nothing
 * to read, and this returns null.
 *
 * ============================================================================
 * WHY A FUNCTION THAT ALWAYS RETURNS NULL IS WORTH HAVING
 * ============================================================================
 *
 * Because the alternative is a boolean literal somewhere in the prompt builder,
 * and a boolean literal is how a system starts quietly claiming things.
 *
 * The prompt has to tell the model, explicitly, that it holds the coaching
 * framework and NO current employee facts — otherwise a model handed a
 * framework full of `[Employee]` placeholders and asked "who should I coach?"
 * has every incentive to fill them in. That instruction has to be driven by
 * whether facts are actually present, and this is the thing that knows.
 *
 * When an employee performance report is eventually ingested, it is read HERE,
 * this returns a rendered block, and the prompt's no-facts branch turns itself
 * off. Nothing else in the chat path needs to change — which is the point of
 * putting the seam in before the data arrives rather than after.
 *
 * DO NOT make this synthesise, estimate or infer employee figures from the
 * salon-level reports. A salon's spa conversion is not an employee's, and
 * dividing one by a headcount is an invention with a number attached.
 */

export interface EmployeeFactsAvailability {
  /** Whether any current employee-level performance data was found. */
  readonly available: boolean;
  /**
   * The rendered facts block for the prompt, or null when there is none.
   * Never a placeholder, never a partial, never an estimate.
   */
  readonly block: string | null;
  /**
   * Why there are no facts, for the audit trail and for the operator. Null once
   * facts exist.
   */
  readonly reason: string | null;
}

export const NO_EMPLOYEE_DATASET_REASON =
  "No employee-level performance dataset has been ingested. The reporting layer holds salon-level data only.";

/**
 * Reads the current employee-level performance facts.
 *
 * Never rejects and never throws: an employee-performance question must still
 * get the framework and an honest "I do not have the figures" rather than an
 * error, so a failure here degrades to "no facts" by construction.
 */
export async function loadEmployeeFacts(): Promise<EmployeeFactsAvailability> {
  return {
    available: false,
    block: null,
    reason: NO_EMPLOYEE_DATASET_REASON,
  };
}
