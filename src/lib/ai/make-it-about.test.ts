import { describe, expect, it } from "vitest";

import { latestMadeAbout, madeAbout, notesMadeAbout, turnsMadeAbout, withObservationMadeAbout } from "./make-it-about";

// QA's Sunny flip-9 tester, item 9 (8 Nov 2026), word for word.
const EDIT = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";

describe("madeAbout", () => {
  it("reads <X> and stops at the next ask", () => {
    expect(madeAbout(EDIT)).toBe("showing up late");
    expect(madeAbout("can you make this about her being on her phone, and change the date to 10/2")).toBe("her being on her phone");
    expect(madeAbout("make the form about cash handling")).toBe("cash handling");
    expect(madeAbout("Make it about leaving early. Thanks")).toBe("leaving early");
  });

  it("is null when nothing says what the form is about", () => {
    expect(madeAbout("make the date for 10/14/26")).toBeNull();
    expect(madeAbout("what is the policy about lateness?")).toBeNull();
    expect(madeAbout("she missed the monthly meeting on 10/10/26")).toBeNull();
    expect(madeAbout("make it about")).toBeNull();
  });
});

describe("turnsMadeAbout", () => {
  const REQUEST = "create a coaching form for Merida Ashcombe, he missed the monthly meeting on 10/10/26";

  it("sets the earlier account aside and keeps <X> and what follows", () => {
    expect(turnsMadeAbout([REQUEST, EDIT])).toEqual(["Showing up late."]);
    expect(turnsMadeAbout([REQUEST, EDIT, "she was 20 minutes late"])).toEqual(["Showing up late.", "she was 20 minutes late"]);
    expect(turnsMadeAbout([`${REQUEST}. ${EDIT} She said her car broke down.`])).toEqual(["Showing up late. She said her car broke down."]);
  });

  it("leaves turns with no \"make it about\" as they are", () => {
    const turns = [REQUEST, "she also left her station early"];
    expect(turnsMadeAbout(turns)).toBe(turns);
    expect(latestMadeAbout(turns)).toBeNull();
  });
});

describe("notesMadeAbout", () => {
  it("rewrites the joined notes the draft route is sent", () => {
    expect(notesMadeAbout(`create a coaching form for Merida Ashcombe, he missed the monthly meeting on 10/10/26\n\n${EDIT}`)).toBe("Showing up late.");
    expect(notesMadeAbout("she was late on 10/10/26")).toBe("she was late on 10/10/26");
  });
});

describe("withObservationMadeAbout", () => {
  it("replaces the card's Observation line with <X>", () => {
    const content = "Here is what I would put on a **Coaching Form**.\n\n**Date:** 10/14/2026\n\n**Observation of Offense:** he missed the monthly meeting on 10/10/26 I need you to make it about showing up late";
    expect(withObservationMadeAbout(content, ["he missed the monthly meeting on 10/10/26", EDIT])).toBe(
      "Here is what I would put on a **Coaching Form**.\n\n**Date:** 10/14/2026\n\n**Observation of Offense:** Showing up late.",
    );
  });

  it("adds the line when the readers left none, and keeps the card as it was without \"make it about\"", () => {
    expect(withObservationMadeAbout("**Date:** 10/14/2026", [EDIT])).toBe("**Date:** 10/14/2026\n\n**Observation of Offense:** Showing up late.");
    expect(withObservationMadeAbout("**Date:** 10/14/2026", ["she was late"])).toBe("**Date:** 10/14/2026");
  });
});
