import { describe, expect, it } from "vitest";

import { addUnderObserved, insertedInOtherSection } from "./outline-sections";

// QA's Bubbles round-16b live test (10 Nov 2026): "can you add that she was reminded of the policy"; the person invented.
const OLD =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting or tell the manager in advance if unable to attend.\n\nGoing Forward:\nOttoline will put every scheduled meeting on the calendar.";
const GLUED = OLD.replace("if unable to attend.", "if unable to attend. Ottoline was reminded of the policy.");

describe("insertedInOtherSection (ADD_OUT_OF_OTHER_SECTIONS_ENABLED)", () => {
  it("words glued onto the end of Expectation are an add, and go under Observed", () => {
    const extra = insertedInOtherSection(OLD, GLUED);
    expect(extra).toBe("Ottoline was reminded of the policy.");
    const written = addUnderObserved(OLD, extra!);
    expect(written.split(/\n\s*Expectation:/)[0]).toContain("Ottoline was reminded of the policy.");
    expect(written).toContain("if unable to attend.\n\nGoing Forward:");
  });

  it("a reworded section, two changed sections, or a changed Observed are left as written", () => {
    expect(insertedInOtherSection(OLD, OLD.replace("every scheduled meeting or", "all meetings or"))).toBeNull();
    expect(insertedInOtherSection(OLD, GLUED.replace("on the calendar.", "on the calendar. Also more."))).toBeNull();
    expect(insertedInOtherSection(OLD, OLD.replace("on 10/10/26.", "on 10/10/26. She was late."))).toBeNull();
    expect(insertedInOtherSection(OLD, OLD)).toBeNull();
  });
});
