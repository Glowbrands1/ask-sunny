import { describe, expect, it } from "vitest";

import { withoutLevelLead } from "./keep-filled-slots";

describe("withoutLevelLead (COMPLAINT_ACCOUNT_ENABLED; QA's audit, 7 Nov 2026)", () => {
  it("the warning level in front of a run-on account comes off", () => {
    expect(withoutLevelLead("verbal warning The date she complained was Oct 31st.")).toBe("The date she complained was Oct 31st.");
    expect(withoutLevelLead("Written warning she was late opening the salon on 11/2")).toBe("she was late opening the salon on 11/2");
    expect(withoutLevelLead("verbal The customer said she was rude to her")).toBe("The customer said she was rude to her");
  });

  it("negative: the level word as part of the account, or a sentence that is only the level, stays", () => {
    expect(withoutLevelLead("written up twice already for being late")).toBe("written up twice already for being late");
    expect(withoutLevelLead("verbal warning given")).toBe("verbal warning given");
    expect(withoutLevelLead("The customer said she was rude")).toBe("The customer said she was rude");
  });
});
