import { expect, vi } from "vitest";

import { activePermissionMatrix, hasPermission, setActivePermissionOverrides } from "@/lib/permissions";
import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A SAVED PERMISSION CHANGE REACHES THE CHAT (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * The Permissions screen now saves to the database and the server enforces it
 * (`permission_overrides`; `activePermissionMatrix()`). Not a manager's report
 * but the same invariant the pack exists for: the chat route and the agent loop
 * must read the gated data only for a role that holds the permission IN FORCE —
 * so an administrator unticking "View Google reviews" for Salon Director takes
 * the review figures out of the chat for them, on the path production takes.
 *
 * The harness's login stand-in checks the active matrix, as `authorizeRequest`
 * does. Each case clears the saved change when it ends.
 */

const QUESTION = "How many Google reviews did we get this week?";
const FLAG = "GOOGLE_REVIEWS_IN_CHAT_ENABLED";
const REPORT = "Pau, 23 Nov 2026: the Permissions screen saves, and the server enforces what is ticked";
const UNTICKED = { salon_director: ["ask_questions", "view_reports", "view_knowledge"] };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.reviewsOnFile!();
  return t.thread();
}

export const NOV23_PERMISSION_OVERRIDE_CASES: ReplayCase[] = [
  {
    id: "nov23-permission-override-removes-reviews-from-chat",
    title: `"${QUESTION}": with "View Google reviews" unticked for Salon Director, the model is given no review figures; ticked, it is`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      try {
        await start(t).say(QUESTION);
        const control = t.lastReportData?.() ?? "";
        expect(control, "control: the defaults give a Salon Director the review figures").toContain("All 15 salons together");

        setActivePermissionOverrides(UNTICKED);
        expect(hasPermission(activePermissionMatrix(), "salon_director", "view_google_reviews")).toBe(false);
        await start(t).say(QUESTION);
        const data = t.lastReportData?.() ?? "";
        expect(data, "a Salon Director whose permission was unticked was still given review figures").not.toContain("All 15 salons together");
        expect(data).not.toMatch(/this week \d+ reviews/);
        expect(data).toContain("This account's role does not include View Google reviews. No review figures were read.");
      } finally {
        setActivePermissionOverrides({});
      }
    },
  },
  {
    id: "nov23-permission-override-removes-reviews-from-agent-loop",
    title: `the tool loop: "${QUESTION}": read_reviews refuses a role whose permission was unticked and returns no figures`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      try {
        setActivePermissionOverrides(UNTICKED);
        const thread = start(t);
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_reviews") ? { text: "Here is what the app shows." } : { tool: "read_reviews", input: {} }));
        t.loopModel!(model);
        await thread.say(QUESTION);
        const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_reviews")).at(-1)?.output ?? {};
        expect(output.refused, "read_reviews gave figures to a role whose permission was unticked").toMatch(/does not include View Google reviews/);
        expect(output.salons).toBeUndefined();
      } finally {
        setActivePermissionOverrides({});
      }
    },
  },
];
