import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A COACHING TYPE THE MANAGER NAMES IS TICKED (ported from Ask Bubbles: QA's 17p live check there, 12 Nov 2026; COACHING_TYPE_STATED_TICKS_ENABLED)
 * ============================================================================
 *
 * A coaching request that named its type was drafted with no Coaching Type ticked: the tick was the drafting model's.
 * Invented wording and person (QA, 12 Nov 2026). The drafting model is scripted to tick nothing, or another type.
 */
const ILSA: DirectoryRow = { id: "e-17p-ilsa-varnholt", firstName: "Ilsa", lastName: "Varnholt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const FIX = ["COACHING_TYPE_STATED_TICKS_ENABLED"];
const DETAILS = { coaching_details: "Observed:\nIlsa Varnholt has been below her sales goals for three weeks." };

async function coaching(t: ReplayContext, request: string, modelTicks: Record<string, string[]>): Promise<Record<string, string[]>> {
  t.directory([...STAFF, ILSA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(request);
  t.draftWrites(DETAILS, modelTicks);
  const id = await thread.create();
  return t.checked(id);
}

export const NOV12_17P_COACHING_TYPE_STATED_CASES: ReplayCase[] = [
  {
    id: "nov12-17p-coaching-type-stated-ticked",
    title: "\"create a coaching for Ilsa Varnholt, coaching on under performance …\": Underperformance is ticked though the model ticks nothing",
    report: "Ported from Ask Bubbles (QA's 17p live check, 12 Nov 2026): a coaching request naming its type saved no Coaching Type",
    status: { open: "Coaching Type is left as the model left it: empty" },
    fixFlags: FIX,
    async run(t) {
      const checked = await coaching(t, "create a coaching for Ilsa Varnholt, coaching on under performance, she has missed her sales goals three weeks running", {});
      expect(checked.coaching_type ?? [], JSON.stringify(checked)).toEqual(["underperformance"]);
    },
  },
  {
    id: "nov12-17p-coaching-type-stated-not-replaced",
    title: "the manager's stated type is never replaced by the model's tick",
    report: "Ported from Ask Bubbles (QA's 17p live check, 12 Nov 2026)",
    status: { open: "the model's Retraining tick replaces the stated Underperformance" },
    fixFlags: FIX,
    async run(t) {
      const checked = await coaching(t, "create a coaching for Ilsa Varnholt, coaching on under performance, she has missed her sales goals three weeks running", { coaching_type: ["retraining"] });
      expect(checked.coaching_type ?? [], JSON.stringify(checked)).toEqual(["underperformance"]);
    },
  },
  {
    id: "nov12-17p-coaching-type-unstated-model-ticks",
    title: "no type named: the model's tick is kept, as before",
    report: "Guard, ported from Ask Bubbles (QA's 17p live check, 12 Nov 2026)",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const checked = await coaching(t, "create a coaching for Ilsa Varnholt, she has missed her sales goals three weeks running", { coaching_type: ["retraining"], coaching_topics: ["product_basics"] });
      expect(checked.coaching_type ?? [], JSON.stringify(checked)).toEqual(["retraining"]);
      expect(checked.coaching_topics ?? [], JSON.stringify(checked)).toEqual(["product_basics"]);
    },
  },
];
