import { describe, expect, it } from "vitest";

import { withoutNamedSalon } from "./tools";

/** QA item 20 (Runner 2's c075): the salon the manager named leaves the account; any other place stays. */
const KEARNEY = "loc-0309";

describe("withoutNamedSalon (item 20)", () => {
  it("takes out a whole at/in phrase naming the card's salon", () => {
    expect(withoutNamedSalon("At Kearney, coaching about bed cleaning.", KEARNEY)).toBe("Coaching about bed cleaning.");
    expect(withoutNamedSalon("She left the beds wet at Kearney.", KEARNEY)).toBe("She left the beds wet.");
    expect(withoutNamedSalon("She was late at the Kearney salon, and left early.", KEARNEY)).toBe("She was late and left early.");
    expect(withoutNamedSalon("In NE Kearney, she skipped the checklist.", KEARNEY)).toBe("She skipped the checklist.");
  });

  it("keeps every other place, a longer proper noun and a work area word for word", () => {
    expect(withoutNamedSalon("She was at lincoln high during her shift.", KEARNEY)).toBe("She was at lincoln high during her shift.");
    expect(withoutNamedSalon("She was rude at the front desk.", KEARNEY)).toBe("She was rude at the front desk.");
    expect(withoutNamedSalon("She left early at Kearney Mall.", KEARNEY)).toBe("She left early at Kearney Mall.");
    expect(withoutNamedSalon("She covered a shift at Grand Island.", KEARNEY)).toBe("She covered a shift at Grand Island.");
  });
});
