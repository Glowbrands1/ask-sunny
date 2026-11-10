import { personRosterNames } from "./person-guard";
import { extractEmployeeNames } from "./proposal";

/*
 * PAST_FORMS_BEFORE_LIBRARY_ENABLED steps aside for the forms library only when the message NAMES A PERSON (the
 * round-3 gate, QA 7 Nov 2026). `candidateNameWords` kept every word that is not a stop word, so "what documents
 * are you referring to in the knowledge base or forms?" and "Do we have a role-play evaluation?" read as naming
 * somebody and lost the library answer. A person here is a name typed as one (`extractEmployeeNames`: "for Jovelle
 * Kerrigan") or a roster person's whole name in any case ("for jovelle kerrigan"), the roster the route enters for
 * the turn.
 */
export function namesAPerson(question: string): boolean {
  if (extractEmployeeNames(question).length > 0) return true;
  const said = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, " ").trim()} `;
  return (personRosterNames() ?? []).some((name) => {
    const whole = name.toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, " ").trim();
    return whole.includes(" ") && said.includes(` ${whole} `);
  });
}
