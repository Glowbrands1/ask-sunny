import { caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";
import { CA_POLICY_LABEL, isSalesPolicyReading, readCaPolicy } from "@/lib/forms/ca-policy";
import { AFFIRMATIVE, type RosterEmployee } from "@/lib/forms/employee-match";
import { managerContext, resolveEmployee } from "@/lib/forms/proposal";

/**
 * ============================================================================
 * AN ANSWER ABOUT A POLICY AND AN EMPLOYEE ENDS WITH ONE OFFER
 * (CA_SALES_POLICY_ENABLED, default off; Pau, 4 Nov 2026, message #5)
 * ============================================================================
 *
 * "<name> did not follow must see behaviors which violates standards of
 * conduct policy" asks for nothing, so it stays a policy answer — no routing
 * change. With the flag on, when the manager's words read as a policy (the
 * existing reader, `readCaPolicy`: named, or one clear suggestion) and name an
 * employee the roster recognises (`resolveEmployee`, matched against the
 * manager's scoped roster), the answer ends with ONE offer to start a
 * Corrective Action for that employee, citing that policy — asked ONCE, in
 * Pau's words: "Do you want a Corrective Action for <name>?". Nothing is made:
 * the card opens only when the manager answers yes (`acceptedCaOffer`), and
 * the yes is read as the request the manager would have typed.
 *
 * No phrase lists: the policy, the employee and the yes are all existing
 * readers. Off, nothing is offered and nothing is read.
 */

/** The offer's opening, which also marks it for the next turn. */
export const CA_OFFER_LEAD = "**Do you want a Corrective Action for";

const OFFER = /\*\*Do you want a Corrective Action for ([^*?]+)\?\*\* Say \*\*yes\*\* and I'll start it, citing the \*\*([^*]+)\*\*\./;

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The roster entry the name is, by full name (first or preferred first name, and last name), or null. */
function onRoster(name: string, roster: readonly RosterEmployee[]): RosterEmployee | null {
  const wanted = fold(name);
  return (
    roster.find((entry) =>
      [entry.firstName, entry.preferredFirstName ?? null]
        .filter((first): first is string => Boolean(first))
        .some((first) => fold(`${first} ${entry.lastName}`) === wanted),
    ) ?? null
  );
}

/**
 * The offer line, or null. Null with the flag off, when the manager's words
 * read as no single policy, or name nobody the roster recognises.
 */
export function caOfferLine(input: {
  readonly history: Parameters<typeof managerContext>[0];
  readonly question: string;
  readonly questionMessageId?: string;
  readonly roster: readonly RosterEmployee[];
}): string | null {
  if (!caSalesPolicyEnabled()) return null;
  const context = managerContext(input.history, { id: input.questionMessageId, content: input.question });
  const reading = readCaPolicy(context.text);
  /*
   * A POLICY THE MANAGER NAMED, or the sales / MSB reading this flag adds —
   * never the general conduct suggestion ("did not complete daily cleaning
   * duties" reads as unfinished work, and a cleaning CA does not cite the
   * Standards of Conduct by default: Pau, 4 Nov 2026; replay sf-s15).
   */
  const policyKey = reading.stated ?? (isSalesPolicyReading(reading) ? reading.suggestion : null);
  if (!policyKey) return null;
  const resolution = resolveEmployee(context);
  if (resolution.kind !== "resolved") return null;
  const employee = onRoster(resolution.employeeName, input.roster);
  if (!employee) return null;
  const name = `${employee.preferredFirstName || employee.firstName} ${employee.lastName}`;
  return `**Do you want a Corrective Action for ${name}?** Say **yes** and I'll start it, citing the **${CA_POLICY_LABEL[policyKey]}**.`;
}

/**
 * The manager's "yes" to the offer, as the request it accepts — "Create a
 * Corrective Action Form for <name>. The policy is <policy>." — or null. Only
 * the offer in the assistant's LAST message counts, and only a plain yes
 * (`AFFIRMATIVE`, the reader the name confirmation uses). Off, null.
 */
export function acceptedCaOffer(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: unknown }[];
}): string | null {
  if (!caSalesPolicyEnabled() || !AFFIRMATIVE.test(input.question)) return null;
  const last = [...input.history].reverse().find((turn) => turn.role === "assistant");
  const match = typeof last?.content === "string" ? OFFER.exec(last.content) : null;
  if (!match) return null;
  return `Create a Corrective Action Form for ${match[1]}. The policy is ${match[2]}.`;
}
