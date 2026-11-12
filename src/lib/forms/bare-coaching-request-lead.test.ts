import { afterEach, describe, expect, it, vi } from "vitest";

import { asksForTheForm, managerAccountClause, withoutFormRequestLead } from "./draft-never-blank";

/* BARE_COACHING_REQUEST_LEAD_ENABLED (QA, Sunny round 31 live, 11 Nov 2026): the tester's wording, the person invented. */
const SAID =
  "create a coaching for Brisa Tolland, she told a client she wouldn't update their info and said our job is to serve clients not chase EFTs. how do i talk to her about her frustration? tell me what to say back.";

afterEach(() => vi.unstubAllEnvs());

describe("BARE_COACHING_REQUEST_LEAD_ENABLED", () => {
  it("off: \"create a coaching for <A>, …\" is not read as the request", () => {
    vi.stubEnv("BARE_COACHING_REQUEST_LEAD_ENABLED", "");
    expect(asksForTheForm(SAID)).toBe(false);
    expect(withoutFormRequestLead("create a coaching for Brisa Tolland, she told a client …")).toBe("create a coaching for Brisa Tolland, she told a client …");
  });

  it("on: it is, and the account starts at \"she told a client\"", () => {
    vi.stubEnv("BARE_COACHING_REQUEST_LEAD_ENABLED", "true");
    vi.stubEnv("REQUEST_LINE_ACCOUNT_ENABLED", "true");
    expect(asksForTheForm(SAID)).toBe(true);
    expect(withoutFormRequestLead("create a coaching for Brisa Tolland, she told a client …")).toBe("she told a client …");
    expect(managerAccountClause(SAID) ?? "").toMatch(/^she told a client/);
  });

  it("on, never: \"coaching\" not followed by \"for\"", () => {
    vi.stubEnv("BARE_COACHING_REQUEST_LEAD_ENABLED", "true");
    expect(asksForTheForm("coaching her was hard, she told a client she wouldn't update their info")).toBe(false);
    expect(withoutFormRequestLead("coaching her was hard, she told a client …")).toBe("coaching her was hard, she told a client …");
  });
});
