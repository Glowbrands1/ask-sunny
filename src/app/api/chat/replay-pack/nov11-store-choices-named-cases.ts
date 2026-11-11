import { expect, vi } from "vitest";

import { salonById } from "@/data/salons";

import { STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE SALON QUESTION NEVER NAMED THE SALONS (ported from Ask Bubbles: Problem 20, production there, 10 Nov 2026;
 * STORE_CHOICES_NAMED_ENABLED)
 * ============================================================================
 *
 * The sibling app's report, in the manager's words (this app's setting; the person is invented): a manager covering two
 * salons asks for a coaching form for a metric, names the person, is asked "Which salon is this about?", sends the
 * request again and gets the same question back with no salon named.
 */
const ASK = "Can you make a coaching form for my employees that had a lower than $50 average transaction this weekend";
const FIX = ["STORE_CHOICES_NAMED_ENABLED"];
const REPORT = "Ported from Ask Bubbles (Problem 20, 10 Nov 2026): the salon question repeated with no salon named";

const WREN: DirectoryRow = {
  id: "e-wren-tallis-p20",
  firstName: "Wren",
  lastName: "Tallis",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0307", "loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T20:39:00Z"));
  t.directory([...STAFF, WREN]);
  t.as("salon_director", TWO_SALONS);
  return t.thread();
}

const SALONS = () => [salonById("loc-0307")!.name, salonById("loc-0309")!.name];

export const NOV11_STORE_CHOICES_NAMED_CASES: ReplayCase[] = [
  {
    id: "nov11-p20-salon-question-names-the-salons",
    title: "the salon question names the manager's two salons, and the request sent again is answered with them",
    report: REPORT,
    status: { open: "\"Which salon is this about?\" names no salon, on the first ask and again after the request is sent again" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(ASK);
      const named = await thread.say("This is for Wren Tallis");
      expect(thread.proposal, `no card for Wren:\n${named.content}`).toMatchObject({ employeeName: "Wren Tallis", status: "needs_location" });
      for (const salon of SALONS()) expect(named.content, `the salon question does not name ${salon}`).toContain(salon);
      const again = await thread.say(ASK);
      for (const salon of SALONS()) expect(again.content, `sent again, the reply does not name ${salon}`).toContain(salon);
    },
  },
];
