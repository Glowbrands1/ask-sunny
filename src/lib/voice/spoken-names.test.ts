import { describe, expect, it } from "vitest";

import { correctSpokenNames, directorySpellingFor, soundKey, spokenNameKeyterms, spokenVocabulary, type SpokenPlace } from "./spoken-names";
import type { RosterEmployee } from "@/lib/forms/employee-match";

/*
 * The owner, 27 Nov 2026, on live voice input: "i said Curt, it spelled it as Kurt". Every person here is invented, of
 * the same shape as the report (a C/K first name the provider spelled the other way): the directory's "Cade Holloway" is
 * heard as "Kade Holloway", and "Cyrus Vale" as "Sirus Vale".
 */

const person = (id: string, firstName: string, lastName: string, salonIds = ["loc-0001"], preferredFirstName: string | null = null): RosterEmployee => ({
  id,
  firstName,
  lastName,
  preferredFirstName,
  salonIds,
});

const ROSTER: RosterEmployee[] = [
  person("e1", "Cade", "Holloway"),
  person("e2", "Cyrus", "Vale"),
  person("e3", "Marissa", "Quillon"),
  person("e4", "Theodora", "Pembrey", ["loc-0001"], "Teddi"),
  person("e5", "Philippa", "Arkwright", ["loc-0002"]),
];

const PLACES: SpokenPlace[] = [
  { id: "loc-0001", names: ["Kearney"] },
  { id: "loc-0002", names: ["Lincoln O Street", "O St Lincoln"] },
];

const vocabulary = spokenVocabulary(ROSTER, PLACES);

describe('"i said Curt, it spelled it as Kurt" (the owner, 27 Nov 2026)', () => {
  it("i said Cade, it spelled it as Kade: the directory spelling comes back", () => {
    expect(correctSpokenNames("Hey can you create a CA for Kade Holloway please", vocabulary)).toBe(
      "Hey can you create a CA for Cade Holloway please",
    );
  });

  it("a C heard as an S: Sirus is Cyrus", () => {
    expect(correctSpokenNames("Write up Sirus Vale for the no call no show", vocabulary)).toBe("Write up Cyrus Vale for the no call no show");
  });

  it("Ph heard as F, -ie as -y, a doubled letter dropped", () => {
    expect(correctSpokenNames("Filippa Arkwright and Teddy Pembrey and Marisa Quillon", vocabulary)).toBe(
      "Philippa Arkwright and Teddi Pembrey and Marissa Quillon",
    );
  });

  it("a salon name heard close is written as the app writes it", () => {
    expect(correctSpokenNames("How is Kearny doing this month", vocabulary)).toBe("How is Kearney doing this month");
  });

  it("the same sounds share a key", () => {
    expect(soundKey("Kade")).toBe(soundKey("Cade"));
    expect(soundKey("Sirus")).toBe(soundKey("Cyrus"));
    expect(soundKey("Filippa")).toBe(soundKey("Philippa"));
  });
});

describe("what it never does", () => {
  it("a name the directory has is left as it is, even when another spelling of it works there too", () => {
    // A real "Kade" in scope wins over the correction to "Cade".
    const both = spokenVocabulary([...ROSTER, person("e9", "Kade", "Brannock")], PLACES);
    expect(correctSpokenNames("Kade Brannock and Cade Holloway", both)).toBe("Kade Brannock and Cade Holloway");
  });

  it("two directory spellings close to what was heard: left as heard", () => {
    const two = spokenVocabulary([person("a", "Marissa", "Quillon"), person("b", "Morris", "Tennant")], []);
    expect(directorySpellingFor("Maris", two)).toBeNull();
    expect(correctSpokenNames("Maris said yes", two)).toBe("Maris said yes");
  });

  it("two people with the same spelling do not make the spelling ambiguous", () => {
    const twins = spokenVocabulary([person("a", "Cyrus", "Vale"), person("b", "Cyrus", "Okafor")], []);
    expect(correctSpokenNames("Sirus is out today", twins)).toBe("Cyrus is out today");
  });

  it("nobody outside the list it was given: a name not close to anyone stays as heard", () => {
    expect(correctSpokenNames("Zebulon Quarry called the salon", vocabulary)).toBe("Zebulon Quarry called the salon");
  });

  it("a lower-case word is not read as a name", () => {
    expect(correctSpokenNames("she gave a kade reply", vocabulary)).toBe("she gave a kade reply");
  });

  it("an everyday word is never rewritten", () => {
    const mark = spokenVocabulary([person("a", "Marc", "Dunleavy")], []);
    expect(correctSpokenNames("Mark the form done for Marc", mark)).toBe("Mark the form done for Marc");
  });

  it("people outside this manager's scope are not in the vocabulary, so cannot be written in", () => {
    // The caller passes the scoped roster only: a salon-0001 manager's list has no salon-0002 person.
    const ownOnly = spokenVocabulary(ROSTER.filter((entry) => entry.salonIds.includes("loc-0001")), []);
    expect(correctSpokenNames("Filippa Arkwright is late", ownOnly)).toBe("Filippa Arkwright is late");
  });

  it("no vocabulary, no change", () => {
    expect(correctSpokenNames("Kade Holloway", spokenVocabulary([], []))).toBe("Kade Holloway");
  });
});

describe("the hint list", () => {
  it("places first, own salon first; then the manager's own salon's people, full names, then first names", () => {
    const { places, people } = spokenNameKeyterms(ROSTER, PLACES, ["loc-0002"]);
    expect(places).toEqual(["Lincoln O Street", "O St Lincoln", "Kearney"]);
    expect(people.slice(0, 1)).toEqual(["Philippa Arkwright"]);
    expect(people).toContain("Teddi Pembrey");
    expect(people).toContain("Theodora Pembrey");
    expect(people).toContain("Cade");
    expect(people.indexOf("Cade Holloway")).toBeLessThan(people.indexOf("Cade"));
  });
});
