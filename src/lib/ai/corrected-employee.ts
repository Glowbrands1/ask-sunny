import { correctedEmployeeSlotEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, matchEmployeeName } from "@/lib/forms/employee-match";
import { employeeState, managerContext, readEmployeeMentions } from "@/lib/forms/proposal";

import type { GroundedPerson } from "./grounded-entities";

type Grounded = {
  readonly person: GroundedPerson | null;
  readonly name: string | null;
  readonly ambiguous: readonly GroundedPerson[];
  readonly typed: string | null;
};

/**
 * CORRECTED_EMPLOYEE_SLOT_ENABLED. QA live, 29 Oct 2026: on an open
 * Resignation/Exit card for one person, "actually this is for <another>"
 * (or "actually it's for rowan kestrel", on the roster) came back with the
 * card still naming the first person — Create would have filed the exit for
 * the wrong person. The person resolver read the correction; the intent
 * slots fell back to the first roster person in the conversation. When THIS
 * turn names the person the manager's own turns now settle on, and the
 * grounding read somebody else or nobody, that person is the employee.
 * Off: the grounding as it came.
 */
export function withCorrectedEmployee<T extends Grounded>(
  grounded: T,
  history: readonly { readonly role: string; readonly content: string; readonly id?: string }[],
  question: string,
  people: readonly GroundedPerson[],
): T {
  if (!correctedEmployeeSlotEnabled()) return grounded;
  const named = readEmployeeMentions(question).names;
  if (named.length === 0) return grounded;
  const prior = history
    .filter((turn) => turn.role === "user")
    .map((turn) => ({ id: turn.id ?? "", role: "user" as const, content: turn.content }));
  const state = employeeState(managerContext(prior, { content: question }));
  if (state.resolution.kind !== "resolved") return grounded;
  const settled = state.resolution.employeeName;
  const same = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
  if (!named.some((name) => same(name, settled))) return grounded;
  if (grounded.name && same(grounded.name, settled)) return grounded;
  const match = people.length > 0 ? matchEmployeeName(settled, people) : null;
  if (match?.kind === "exact") {
    const person = people.find((row) => row.id === match.employee.id) ?? null;
    if (person) return { ...grounded, person, name: displayName(person), ambiguous: [], typed: settled };
  }
  return { ...grounded, person: null, name: settled, ambiguous: [], typed: settled };
}
