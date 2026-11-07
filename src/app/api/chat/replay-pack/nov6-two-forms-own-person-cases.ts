import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * TWO FORMS FOR TWO PEOPLE IN ONE MESSAGE: THE CARD IS NEVER THE OTHER FORM'S
 * PERSON (QA, Sunny tester after the flip, 6 Nov 2026, row 6;
 * TWO_FORMS_OWN_PERSON_ENABLED)
 * ============================================================================
 *
 * "Coaching form for <R>. Also a CA for <R2>." gave ONE card: a Coaching Form
 * whose employee was R2, the Corrective Action's person, and the reply named
 * nobody. Not the flip (QA's bisect, 6 Nov 2026): the models' reading of R2
 * won over the coaching request's own "for <R>". This app makes one card per
 * message; with the flag on, that card's employee is the person its own clause
 * names, or it is empty and asks, and the reply names the other request. The
 * people are invented and not on either directory.
 */
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});
const PEREGRINE = person("e-peregrine-ashcombe", "Peregrine", "Ashcombe");
const TAMSIN = person("e-tamsin-wexley", "Tamsin", "Wexley");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function twoFormsOwnPersonPeople(): readonly DirectoryRow[] {
  return [PEREGRINE, TAMSIN];
}

const SHAPES: { key: string; text: string; read: string }[] = [
  { key: "full", text: "Coaching form for Peregrine Ashcombe. Also a CA for Tamsin Wexley.", read: "Tamsin Wexley" },
  { key: "first-names", text: "Coaching form for Peregrine. Also a CA for Tamsin.", read: "Tamsin" },
  { key: "lowercase", text: "coaching form for peregrine ashcombe. also a ca for tamsin wexley", read: "tamsin wexley" },
];

export const NOV6_TWO_FORMS_OWN_PERSON_CASES: ReplayCase[] = SHAPES.map(({ key, text, read }) => ({
  id: `nov6-two-forms-own-person-${key}`,
  title: `row 6 (${key}): "${text}" with the models reading the CA's person: the Coaching card is never Tamsin, and the reply names the CA request`,
  report: "QA, 6 Nov 2026 (Sunny tester after the flip, row 6, paraphrased): one Coaching card with the CA's person as its employee",
  status: { open: "the Coaching card's employee is the Corrective Action's person (the models' reading wins), and the CA request is not named" },
  fixFlags: ["TWO_FORMS_OWN_PERSON_ENABLED"],
  async run(t) {
    vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
    t.directory([...STAFF, PEREGRINE, TAMSIN]);
    t.as("salon_director", KEARNEY);
    // The production shape: the models read the Corrective Action's person as the employee.
    t.slotsRead({ employee: read, formType: "Coaching Form", formTurn: true }, read);
    const thread = t.thread();
    const reply = await thread.say(text);
    if (!thread.proposal) {
      // No card (first names, the models' reading offered as "Is this for …?"): nobody is offered, and both requests are named back.
      expect(reply.content, "the other form's person is offered").not.toMatch(/is this for \*\*tamsin/i);
      expect(reply.content, "the requests are not named back").toMatch(/\*\*coaching form\*\*[^\n]*\*\*corrective action form\*\*/i);
      return;
    }
    expect(thread.proposal.templateKey, `not a Coaching card:\n${reply.content}`).toBe("coaching");
    const employee = thread.proposal?.employeeName ?? null;
    expect(employee === null || /peregrine/i.test(employee), `the Coaching card is for ${employee}:\n${reply.content}`).toBe(true);
    if (employee === null) expect(reply.content, "an empty card does not ask who").toMatch(/who is this \*\*coaching form\*\* for/i);
    /*
     * Changed on purpose (coding 2, 8 Nov 2026; QA's round-4 gate): with TWO_FORMS_EACH_PERSON_ENABLED on (#646) the
     * Corrective Action is offered next ("**Do you want a Corrective Action Form for Tamsin Wexley next?**") instead of
     * named back as "you also asked for"; either way the request is not lost.
     */
    expect(reply.content, "the Corrective Action request is not named back").toMatch(
      /you also asked for a \*\*corrective action form\*\* for \*\*tamsin|\*\*do you want a corrective action form for tamsin wexley next\?\*\*/i,
    );
  },
}));
