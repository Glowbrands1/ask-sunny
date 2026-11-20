import { describe, expect, it } from "vitest";

import { matchEmployeeName } from "./employee-match";
import { foldName } from "./fold-name";
import { samePerson } from "./proposal";

/* QA's code audit on d7960a5f, item 13 (20 Nov 2026): accents and curly apostrophes. Invented names. */
describe("foldName", () => {
  it("drops accents without splitting the word, and straightens apostrophes", () => {
    expect(foldName("Ramírez")).toBe("Ramirez");
    expect(foldName("Lucía Ramírez")).toBe("Lucia Ramirez");
    expect(foldName("D’Angelo")).toBe("D'Angelo");
    expect(foldName("Zoë Brontë")).toBe("Zoe Bronte");
  });
  it("samePerson and the name check read them as the same person", () => {
    expect(samePerson("lucia ramirez", "Lucía Ramírez")).toBe(true);
    expect(samePerson("Nico D’Angelo", "Nico D'Angelo")).toBe(true);
    const roster = [{ id: "e-1", firstName: "Lucía", lastName: "Ramírez", preferredFirstName: null, employmentStatus: "active", salonIds: [], positionName: null }];
    expect(matchEmployeeName("lucia ramirez", roster as never).kind).toBe("exact");
  });
});
