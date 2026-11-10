import { describe, expect, it } from "vitest";

import { endMadeAboutWrite, madeAboutTopic, madeAboutWriteNoted, noteMadeAboutWrite } from "./made-about-date";

/**
 * MADE_ABOUT_ALL_OR_NOTHING_ENABLED (QA's live round-7 test, the sibling app, 9 Nov 2026, ported; the person invented): the topic read
 * from the manager's words when the reader read none, and the note that lets the old path's revision drop the old date
 * only while Step B writes the Date and the topic. The route is in the replay pack (`nov9-made-about-all-or-nothing-cases.ts`).
 */
const TODAY = "2026-11-09";

describe("madeAboutTopic", () => {
  it("\"make it about leaving the front desk unattended on 11/6/26\" → \"Leaving the front desk unattended\"", () => {
    expect(madeAboutTopic("make it about leaving the front desk unattended on 11/6/26", TODAY)).toBe("Leaving the front desk unattended");
  });

  it.each([
    ["I need you to make it about showing up late on 11/4/26", "Showing up late"],
    ["make it about missing the 11/5 deadline", "Missing the deadline"],
  ])("%s → %s", (said, topic) => {
    expect(madeAboutTopic(said, TODAY)).toBe(topic);
  });

  it("no \"make it about\": null", () => {
    expect(madeAboutTopic("she left the front desk unattended on 11/6/26", TODAY)).toBeNull();
  });
});

describe("the coordinated write", () => {
  it("is noted only between note and end", () => {
    expect(madeAboutWriteNoted("inst-1")).toBe(false);
    noteMadeAboutWrite("inst-1");
    expect(madeAboutWriteNoted("inst-1")).toBe(true);
    expect(madeAboutWriteNoted("inst-2")).toBe(false);
    endMadeAboutWrite("inst-1");
    expect(madeAboutWriteNoted("inst-1")).toBe(false);
  });
});
