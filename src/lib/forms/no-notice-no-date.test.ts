import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readExitFacts } from "./exit-facts";

/**
 * NO_NOTICE_NO_DATE_ENABLED (port of the sibling app's, QA, its flip-3 tester, 6 Nov 2026, B): "exit form for <X>, resigned 11-3-26
 * with no notice, not eligible for rehire" put "Date that notice was given: November 3, 2026" on the
 * form. "resigned" is a notice-given cue (handing in notice is resigning), so the resignation date
 * was also read as the notice date, although the manager said no notice was given. An invented fact
 * on a legal form. The person is invented and not on either directory.
 */
const TESTER = "exit form for Peregrine Ashcombe, resigned 11-3-26 with no notice, not eligible for rehire";
const TODAY = "2026-11-06";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("NO_NOTICE_NO_DATE_ENABLED", () => {
  it("off (main): the resignation date is also the notice date (the bug)", () => {
    expect(readExitFacts(TESTER, TODAY).noticeGiven).toBe("2026-11-03");
  });

  it.each([
    TESTER,
    "exit form for Peregrine Ashcombe, she quit on 11/3/26 without notice",
    "Peregrine Ashcombe resigned 11-3-26, did not give notice",
    "Exit form for Peregrine Ashcombe. Resigned 11-3-26. No notice.",
  ])("on: %s has no notice date, and keeps the resignation date", (text) => {
    vi.stubEnv("NO_NOTICE_NO_DATE_ENABLED", "true");
    const facts = readExitFacts(text, TODAY);
    expect(facts.noticeGiven).toBeNull();
    expect(facts.resignationDate).toBe("2026-11-03");
  });

  it("on, negative: notice that was given keeps its date", () => {
    vi.stubEnv("NO_NOTICE_NO_DATE_ENABLED", "true");
    expect(readExitFacts("exit form for Peregrine Ashcombe, gave notice 10/20/26, last day 11/3/26", TODAY).noticeGiven).toBe("2026-10-20");
  });
});
