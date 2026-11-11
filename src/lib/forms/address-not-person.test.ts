import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withAddressNotPerson } from "./person-guard";

/** ADDRESS_NOT_PERSON_ENABLED — QA's live check, 3 Nov 2026: "coaching form for 123 Main Street". Invented people. */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ADDRESS_NOT_PERSON_ENABLED;
  process.env.ADDRESS_NOT_PERSON_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADDRESS_NOT_PERSON_ENABLED;
  else process.env.ADDRESS_NOT_PERSON_ENABLED = saved;
});

const card = (employeeName: string) => ({
  content: "Here is what I would put on a **Coaching Form**.",
  formProposal: { employeeName, status: "ready", templateName: "Coaching Form", supportsInlineDraft: true } as {
    employeeName: string | null;
    status: string;
    templateName: string;
    supportsInlineDraft?: boolean;
  },
});

describe("a name after a house number is an address", () => {
  it("QA's words: cleared, and the card asks who", () => {
    const answer = withAddressNotPerson(card("Main Street"), ["coaching form for 123 Main Street"]);
    expect(answer.formProposal.employeeName).toBeNull();
    expect(answer.formProposal.status).toBe("needs_employee");
    expect(answer.content).toMatch(/Who is this \*\*Coaching Form\*\* for\?/);
  });

  it("the next turn names no one: the address from the earlier turn is still not a person, and the reply just asks", () => {
    const answer = withAddressNotPerson(card("Main Street"), ["coaching form for 123 Main Street", "make a coaching form for <name>, she was late today"]);
    expect(answer.formProposal.employeeName).toBeNull();
    // QA live check, 3 Nov 2026: the old sentence about "Main Street" was repeated word for word.
    expect(answer.content).toBe("Who is this **Coaching Form** for? Tell me the employee's full name.");
  });

  for (const [name, turns] of [
    ["Jamie Lane", ["coaching form for Jamie Lane, she was late"]],
    ["Rowan Court", ["coaching for Rowan Court — she lives at 12 Oak Lane"]],
    ["Remy Calder", ["coaching for Remy Calder about the 2 lotions she left out"]],
  ] as const) {
    it(`${JSON.stringify(name)}: a person, kept`, () => {
      expect(withAddressNotPerson(card(name), [...turns]).formProposal.employeeName).toBe(name);
    });
  }

  it("off: kept", () => {
    process.env.ADDRESS_NOT_PERSON_ENABLED = "false";
    expect(withAddressNotPerson(card("Main Street"), ["coaching form for 123 Main Street"]).formProposal.employeeName).toBe("Main Street");
  });
});

/**
 * QA live check, 3 Nov 2026 (~15:00 UTC): with ADDRESS_NOT_PERSON on, a real
 * name right after a date's digits was refused as "a street address" three
 * times ("26 Jane Doe", "2026 corin bellweather"). A date's digits are never a
 * house number. Invented people.
 */
describe("a name right after a date is a person, not an address", () => {
  const TODAY = "2026-11-03";

  it('"On 10-20-26 Jane Doe was late to open" keeps the name', () => {
    const answer = withAddressNotPerson(card("Jane Doe"), ["On 10-20-26 Jane Doe was late to open"], TODAY);
    expect(answer.formProposal.employeeName).toBe("Jane Doe");
    expect(answer.formProposal.status).toBe("ready");
  });

  it('"... on Monday 10/05/2026 corin bellweather was working a shift ..." keeps the name', () => {
    const turns = ["Put together a written CA for corin bellweather. But on Monday 10/05/2026 corin bellweather was working a shift at the other salon and did not complete the 10 minute disinfect"];
    expect(withAddressNotPerson(card("Corin Bellweather"), turns, TODAY).formProposal.employeeName).toBe("Corin Bellweather");
  });

  it("a house number still makes an address, even with a date in the same turn", () => {
    const answer = withAddressNotPerson(card("Main Street"), ["on 10-20-26 make a coaching form for 123 Main Street"], TODAY);
    expect(answer.formProposal.employeeName).toBeNull();
  });

  it('"Create a CA for Jane Doe, she was late on 10-20-26" was never affected', () => {
    expect(withAddressNotPerson(card("Jane Doe"), ["Create a CA for Jane Doe, she was late on 10-20-26"], TODAY).formProposal.employeeName).toBe("Jane Doe");
  });
});
