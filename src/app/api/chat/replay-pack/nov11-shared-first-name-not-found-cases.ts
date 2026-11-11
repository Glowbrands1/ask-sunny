import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * A SHARED ROSTER FIRST NAME IS NEVER "NOT FOUND" (the sibling app's 16c re-gate on production flags, via QA, 10 Nov 2026; checked here on r22).
 *
 * With FORM_NAME_FROM_ROSTER on, P7's "Make me a coaching form for Tamsin, Corwin, and Ione for not closing duties
 * correctly", with two roster people called Tamsin, opened "I couldn't find **Tamsin** in the Woven roster, so that name
 * is not on the form." and then asked "Did you mean Tamsin Ashby or Tamsin Rookwood?": the first line is false and
 * contradicts the question. A bare shared first name ("a coaching form for Tamsin") is the same. No not-found note when
 * a "Did you mean" choice follows, or when the typed name is a roster first name (`withNotFoundNote`,
 * forms/roster-only-names.ts; with FORM_NAME_FROM_ROSTER). Invented people.
 */
const row = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});
const PEOPLE = [row("sf-tamsin-rookwood", "Tamsin", "Rookwood"), row("sf-tamsin-ashby", "Tamsin", "Ashby"), row("sf-corwin-halsey", "Corwin", "Halsey"), row("sf-ione-marchetti", "Ione", "Marchetti")];
const NOT_FOUND = /I couldn['’]t find \*\*Tamsin\*\*/;
const REPORT = "the sibling app's 16c re-gate (production flags), via QA 10 Nov 2026: \"I couldn't find **Tamsin**\" above \"Did you mean Tamsin Ashby or Tamsin Rookwood?\"";

export const NOV11_SHARED_FIRST_NAME_NOT_FOUND_CASES: ReplayCase[] = [
  ["p7", "Make me a coaching form for Tamsin, Corwin, and Ione for not closing duties correctly"],
  ["bare", "a coaching form for Tamsin"],
].map(([id, said]) => ({
  id: `nov11-shared-first-name-not-found-${id}`,
  title: `"${said}" with two roster people called Tamsin: never "I couldn't find **Tamsin**"`,
  report: REPORT,
  status: "fixed",
  async run(t) {
    t.directory([...STAFF, ...PEOPLE]);
    t.as("salon_director", KEARNEY);
    const reply = await t.thread().say(said!);
    expect(reply.content, `a roster first name said back as not found:\n${reply.content}`).not.toMatch(NOT_FOUND);
  },
}));
