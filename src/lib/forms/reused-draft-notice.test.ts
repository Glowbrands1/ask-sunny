import { describe, expect, it } from "vitest";

import { reusedDraftNotice } from "./reused-draft-notice";

describe("the card's line for a reopened draft (DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED)", () => {
  it("names the draft's date as the manager writes it", () => {
    expect(reusedDraftNotice("2026-10-20")).toBe("Updated your open draft from 10/20/2026");
  });

  it("shows anything that is not a calendar date as given", () => {
    expect(reusedDraftNotice("today")).toBe("Updated your open draft from today");
  });
});
