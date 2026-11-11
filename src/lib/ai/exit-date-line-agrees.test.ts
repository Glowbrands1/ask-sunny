import { afterEach, describe, expect, it, vi } from "vitest";

import { replyMatchesCard } from "./reply-matches-card";
import type { AskResponse } from "./types";

/**
 * EXIT_DATE_LINE_AGREES_ENABLED (QA round 5, 8 Nov 2026; production chat of 7 Nov 2026, the employee invented):
 * "exit form for <name>, last day 11/05, gave no notice" listed "Date: the day the draft is created" above a card dated
 * 11/5/2026. The replay pack covers the route (`nov8-exit-date-line-agrees-cases.ts`).
 */
const LIVE = [
  "Here's what I'll fill in on the **Resignation/Exit Form** for **Tamsin Vale**:",
  "",
  "- **Name:** Tamsin Vale",
  "- **Date:** the day the draft is created",
  "- **Last Day Worked:** November 5, 2026",
  "",
  "**Date:** 11/5/2026",
].join("\n");

function reply(formDate: string | null, templateKey = "stc-exit"): AskResponse {
  return {
    content: LIVE,
    citations: [],
    recommendedVideoIds: [],
    formProposal: { templateKey, employeeName: "Tamsin Vale", formDate } as never,
  };
}

describe("EXIT_DATE_LINE_AGREES_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the list keeps \"the day the draft is created\" beside a dated card (the reported reply)", () => {
    expect(replyMatchesCard(reply("2026-11-05"), ["Tamsin Vale"]).content).toContain("- **Date:** the day the draft is created");
  });

  it("on: the list's Date line is the card's date", () => {
    vi.stubEnv("EXIT_DATE_LINE_AGREES_ENABLED", "true");
    const content = replyMatchesCard(reply("2026-11-05"), ["Tamsin Vale"]).content;
    expect(content).toContain("- **Date:** November 5, 2026");
    expect(content).not.toContain("the day the draft is created");
  });

  it("on: a card with no date keeps \"the day the draft is created\"", () => {
    vi.stubEnv("EXIT_DATE_LINE_AGREES_ENABLED", "true");
    expect(replyMatchesCard(reply(null), ["Tamsin Vale"]).content).toContain("- **Date:** the day the draft is created");
  });

  it("on: another form's reply is untouched", () => {
    vi.stubEnv("EXIT_DATE_LINE_AGREES_ENABLED", "true");
    expect(replyMatchesCard(reply("2026-11-05", "dpoa"), ["Tamsin Vale"]).content).toContain("the day the draft is created");
  });
});
