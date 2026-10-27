import "server-only";

import { authorizeInstance } from "./instance-scope";
import { namesAnotherEmployee, namingTheForm, typedPeopleAfterFor } from "./other-employee";

/**
 * DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED: when the open form is for one employee
 * and the turn asks for a form for somebody else, the form to propose next (the
 * open form's own template, and the turn with that form named in it), so the
 * turn gets its own card and the open form
 * is neither corrected, redrafted nor revised. Null for any other turn, and for
 * a form this caller may not read. See `other-employee.ts`.
 *
 * The names the conversation already knows (QA-6) are the open form's employee
 * and the people the manager typed after "for" earlier in this chat, so a
 * lower-case "rowan pell" is read wherever "for" gives it.
 */
export async function otherEmployeeForm(input: {
  readonly request: Request;
  readonly instanceId: string;
  readonly question: string;
  readonly history?: readonly { readonly role: string; readonly content: string }[];
}): Promise<{ templateKey: string; question: string } | null> {
  try {
    const { loaded } = await authorizeInstance(input.request, input.instanceId, "view");
    const known = (input.history ?? [])
      .filter((turn) => turn.role === "user")
      .flatMap((turn) => typedPeopleAfterFor(turn.content));
    if (!namesAnotherEmployee(input.question, loaded.instance.employeeName, known)) return null;
    return {
      templateKey: loaded.instance.templateKey,
      question: namingTheForm(input.question, loaded.instance.templateName),
    };
  } catch {
    return null;
  }
}
