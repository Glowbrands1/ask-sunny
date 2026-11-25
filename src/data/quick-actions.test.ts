import { describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { readFileSync } from "node:fs";

import { DAILY_STATS_QUESTION, DASHBOARD_QUICK_ACTIONS } from "./quick-actions";

/*
 * FORMS ARE ONLY CREATED BY CHATTING WITH ASK SUNNY. The Create a Form screen
 * was removed, and the Overview's coaching shortcut used to deep-link into it.
 */
describe("the coaching quick action", () => {
  it("points at no form screen", () => {
    for (const action of DASHBOARD_QUICK_ACTIONS) {
      expect(action.href, action.id).not.toContain("/forms/create");
    }
  });

  it("opens Ask Sunny with a request Sunny reads as a coaching form", () => {
    const action = DASHBOARD_QUICK_ACTIONS.find((entry) => entry.id === "qa-coaching")!;
    const url = new URL(action.href, "https://ask-sunny.test");

    expect(url.pathname).toBe("/chat");
    expect(detectTemplateIntent(url.searchParams.get("q")!)).toEqual({
      kind: "explicit",
      templateKey: "coaching",
    });
  });
});

/*
 * QA, 24 Nov 2026 (Ask Sunny, live): the home quick action "Review Daily Stats" linked to /reports, which redirects to
 * Salon Performance. No Daily Stats page exists; only the AI's read_stats reads Daily Stats.
 */
describe("the Review Daily Stats quick action", () => {
  const action = DASHBOARD_QUICK_ACTIONS.find((entry) => entry.id === "qa-stats")!;

  it("QA: \"Review Daily Stats\" no longer links to /reports (Salon Performance)", () => {
    expect(action.label).toBe("Review Daily Stats");
    expect(action.href).not.toMatch(/^\/reports/);
  });

  it("opens the chat with a Daily Stats question", () => {
    const url = new URL(action.href, "https://ask-sunny.test");
    expect(url.pathname).toBe("/chat");
    expect(url.searchParams.get("q")).toBe(DAILY_STATS_QUESTION);
    expect(DAILY_STATS_QUESTION).toMatch(/\bDaily Stats\b/);
  });

  it("asks the question the replay pack proves reaches read_stats", () => {
    const pack = readFileSync("src/app/api/chat/replay-pack/nov15-agent-loop-data-tools-cases.ts", "utf8");
    expect(pack).toContain(`"${DAILY_STATS_QUESTION}"`);
    expect(pack).toContain('"nov15-agent-loop-daily-stats-own-salons"');
  });
});
