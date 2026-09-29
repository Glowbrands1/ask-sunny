import "server-only";

import { readCorrectiveActionIntake } from "./corrective-action-intake";
import { datesInText } from "./form-date-answer";
import { extractEmployeeNames, extractJobTitle } from "./proposal";
import { readSalonMentions } from "./salon-mention";
import { readStatedAddress } from "./stated-address";

/**
 * ============================================================================
 * AN ANSWER TO THE OPEN FORM, OR A NEW SUBJECT?
 * ============================================================================
 *
 * REPORTED BY THE TESTERS as "told sunny twice the employee name, job title and
 * location and sunny still asked for that info". The cause was one line: with a
 * form open, a turn continued it only when it named an employee in one of the
 * positions the name reader accepts. Every other answer to the intake —
 *
 *     "Lawrence, Tanning Consultant, use today's date"
 *     "she did not call in for her shift on saturday"
 *     "her address is 12 Elm St, Lawrence KS 66044"
 *     "employees name lisa smith, location was lawrence…"   (lower case)
 *
 * — named nobody the reader could see, so the turn went to the knowledge base,
 * the model asked for the details again, and because that answer carried no
 * form, the NEXT turn had nothing to continue either. Every later message was
 * then a new subject, however many times the details were given.
 *
 * So a turn that STATES something the form is made of continues it. The
 * readers are the ones the proposal itself uses, so "this turn answers the
 * form" and "this turn changed what the form says" cannot disagree.
 *
 * A QUESTION IS STILL A QUESTION. "What's the policy on no call no shows?"
 * mentions an incident and is asked, not stated; it goes to the knowledge base
 * and the form stays where it was on the turn before.
 */
export function statesFormFacts(text: string, today: string): boolean {
  if (asksSomething(text)) return false;
  if (extractEmployeeNames(text).length > 0) return true;
  if (extractJobTitle(text) !== null) return true;
  if (readSalonMentions(text).length > 0) return true;
  if (readStatedAddress(text) !== null) return true;
  if (datesInText(text, today).length > 0 || /\b(?:today|yesterday)\b/i.test(text)) return true;
  if (LABELLED_ANSWER.test(text)) return true;
  if (POLICY_OR_TRAINING_HISTORY.test(text)) return true;
  const intake = readCorrectiveActionIntake({
    text,
    employeeKnown: false,
    salonSettled: false,
    payrollDeduct: null,
    asksPayrollDeduct: false,
  });
  return intake.supplied.some((key) => key !== "salon" && key !== "employee_name");
}

/** "Name: …", "location was …", "title is …", "date - today". */
const LABELLED_ANSWER =
  /\b(?:name|title|position|role|location|salon|store|date|address)\s*(?:is|was|=|:|-)\s*\S/i;

/** A manager stating what the employee already knows — see `form-opportunity.ts`. */
const POLICY_OR_TRAINING_HISTORY =
  /\b(?:acknowledg\w*|signed (?:off on )?the (?:policy|handbook|manual)|(?:completed|finished|took|passed|went through|has had|had) (?:\w+\s+){0,2}training|was trained|been trained)\b/i;

/**
 * Whether a turn asks rather than states.
 *
 * NARROWER THAN `isQuestion` in `employment-change.ts`, which treats a leading
 * "did" or "is" as a question: "Did not call in for her shift" and "Is a TC at
 * Lawrence" are how managers answer an intake in a hurry.
 */
function asksSomething(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  return /^(?:what|how|when|where|why|who|which|can you|could you|would you|should i|should we|do i|do we|do you|does|is it|is there|are there|tell me about|explain)\b/i.test(
    trimmed,
  );
}
