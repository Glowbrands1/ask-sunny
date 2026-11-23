import { describe, expect, it } from "vitest";

import { firstNameNotPronouns, otherRosterPeopleIn } from "@/lib/forms/first-name-write-up";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * Port of Ask Bubbles #1053 (its QA, 22 Nov 2026, production; the people invented): the manager wrote about <A> (she) and
 * a coworker <B> (she) who was giving <A> an attitude, and the write-up said "<A> was giving <A> an attitude". A pronoun
 * whose nearest named person of its kind is the other person stays as written; an object pronoun is never the person
 * named in its own clause.
 */
const TWO_SHE_WORDS = "ca for Sorcha Vantassel, she got into it with her coworker Petronella Fenmore on the front desk last night. she was giving her an attitude and Sorcha cussed at her in front of guests";
const TWO_SHE = "Sorcha got into it with her coworker Petronella Fenmore on the front desk on 11/21/26. She was giving her an attitude, and Sorcha cussed at her in front of guests.";
const HE_WORDS = "ca for Sorcha Vantassel, she got into it with her coworker Ivo Marrack on the front desk last night. he was giving her an attitude and Sorcha cussed at him in front of guests";
const HE = "Sorcha got into it with her coworker Ivo Marrack on the front desk on 11/21/26. He was giving her an attitude, and Sorcha cussed at him in front of guests.";

describe("two people of one pronoun kind", () => {
  it("the coworker's \"she\" and \"her\" stay as the manager wrote them", () => {
    const { text } = withoutPersonPronouns(TWO_SHE, "Sorcha", ["Petronella Fenmore"], TWO_SHE_WORDS);
    expect(text).toBe("Sorcha got into it with Sorcha's coworker Petronella Fenmore on the front desk on 11/21/26. She was giving her an attitude, and Sorcha cussed at her in front of guests.");
  });

  it("an object pronoun after the coworker named as her clause's subject is the employee", () => {
    const words = "ca for Sorcha Vantassel, petronella fenmore was on the front desk with her. she was giving her an attitude";
    const { text } = withoutPersonPronouns("Sorcha was on the front desk with Petronella Fenmore on 11/21/26. Petronella was giving her an attitude.", "Sorcha", ["Petronella Fenmore"], words);
    expect(text).toBe("Sorcha was on the front desk with Petronella Fenmore on 11/21/26. Petronella was giving Sorcha an attitude.");
  });

  it("Create's write-up opening with the coworker's sentence (nobody named before it): left as written, never the employee", () => {
    const saved = "She was giving her an attitude, and Sorcha cussed at her in front of guests. Sorcha got into it with coworker Petronella Fenmore on the front desk last night.";
    expect(withoutPersonPronouns(saved, "Sorcha", ["Petronella Fenmore"], TWO_SHE_WORDS).text).toBe(saved);
  });

  it("control, one \"she\": still named", () => {
    const { text } = withoutPersonPronouns("Sorcha was rude to a guest on 11/21/26. She rolled her eyes at the guest and walked off.", "Sorcha", [], "ca for Sorcha Vantassel, she was rude to a guest. she rolled her eyes at the guest and walked off");
    expect(text).not.toMatch(/\b[Ss]he\b/);
    expect(text).toMatch(/Sorcha rolled/);
  });

  it("control, the coworker is \"he\": his \"he\" and \"him\" stay, her \"her\" is named", () => {
    const { text } = withoutPersonPronouns(HE, "Sorcha", ["Ivo Marrack"], HE_WORDS);
    expect(text).toBe("Sorcha got into it with Sorcha's coworker Ivo Marrack on the front desk on 11/21/26. He was giving Sorcha an attitude, and Sorcha cussed at him in front of guests.");
  });

  it("another person named with no pronoun of theirs reads as before", () => {
    const words = "ca for Sorcha Vantassel, she was late and Petronella Fenmore covered";
    expect(withoutPersonPronouns("Petronella Fenmore covered the front desk on 11/21/26. She was 40 minutes late.", "Sorcha", ["Petronella Fenmore"], words).text).toBe("Petronella Fenmore covered the front desk on 11/21/26. Sorcha was 40 minutes late.");
  });
});

describe("the saved write-up (Create): the notes' roster people and words", () => {
  const roster = [
    { firstName: "Sorcha", lastName: "Vantassel", preferredFirstName: null },
    { firstName: "Petronella", lastName: "Fenmore", preferredFirstName: null },
    { firstName: "Ivo", lastName: "Marrack", preferredFirstName: null },
    { firstName: "Elspeth", lastName: "Dunleavy", preferredFirstName: "Billie" },
  ];

  it("reads the other roster people the notes name, never the employee by their legal or preferred name", () => {
    expect(otherRosterPeopleIn(TWO_SHE_WORDS, roster, "Sorcha Vantassel")).toEqual(["Petronella Fenmore"]);
    expect(otherRosterPeopleIn("ca for billie dunleavy (elspeth on the roster), petronella was rude", roster, "Billie Dunleavy")).toEqual(["Petronella Fenmore"]);
  });

  it("the coworker's \"she\" is never the employee in the saved Observation", () => {
    const out = firstNameNotPronouns({ observation: TWO_SHE }, "Sorcha Vantassel", new Set(["observation"]), { others: otherRosterPeopleIn(TWO_SHE_WORDS, roster, "Sorcha Vantassel"), managerWords: TWO_SHE_WORDS });
    expect(out.values.observation).not.toMatch(/Sorcha was giving|Sorcha cussed at Sorcha/);
  });

  it("U23: another employee's \"they\" stays \"they\" in the saved Observation when the manager calls the person \"she\"", () => {
    const words = "Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs.";
    const out = firstNameNotPronouns({ observation: "Sorcha asked another employee what they would do if they had 8 arms and 8 legs." }, "Sorcha Vantassel", new Set(["observation"]), { others: [], managerWords: words });
    expect(out.values.observation).toMatch(/what they would do if they had 8 arms/);
  });

  it("without the people (as before), unchanged behaviour", () => {
    const out = firstNameNotPronouns({ observation: "She was late on 11/21/26." }, "Sorcha Vantassel", new Set(["observation"]));
    expect(out.values.observation).toBe("Sorcha was late on 11/21/26.");
  });
});
