import { describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { DASHBOARD_QUICK_ACTIONS } from "./quick-actions";

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
