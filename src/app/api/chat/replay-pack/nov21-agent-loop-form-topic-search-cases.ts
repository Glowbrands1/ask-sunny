import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FORMS ON FILE BY TOPIC (FORM_TOPIC_SEARCH_ENABLED; Pau, 21 Nov 2026)
 * ============================================================================
 *
 * Pau wants a manager to ask "any forms about cash handling at my salons this month?" or "who's been written up for
 * dress code?" and get the matching forms. find_past_forms with a topic (about) and no employee searches the saved text
 * of every form the manager may see in Form Monitoring, and nothing wider. Each form is made through the chat (Create,
 * with the drafting model's Observation); one dress-code form is then moved to another salon, which this salon director
 * cannot see: it must never reach the model. Default off: open on production's flags, holding with the flag on.
 * Invented people only (the replay staff list).
 */

const FIX = ["FORM_TOPIC_SEARCH_ENABLED"];
const STATUS = { open: "FORM_TOPIC_SEARCH_ENABLED is off in production (default off; QA flips it)" } as const;
const REPORT = "Pau (21 Nov 2026): \"any forms about cash handling at my salons this month?\" / \"who's been written up for dress code?\" should find the matching forms";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Out = { forms?: { instance_id?: string; employee?: string; form_date?: string }[]; counts?: { total: number; people: number }; listed?: number; of?: number; reason_code?: string };

/** One CA made through the chat for `employeeId`, its Observation the drafting model's `observation`. */
async function caOnFile(t: ReplayContext, employeeId: string, said: string, observation: string): Promise<string> {
  t.loopModel!(loopStandIn((view): LoopDecision => (view.results.some((result) => result.tool === "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: employeeId, what_happened: observation, incident_date: "2026-11-12" } })));
  const thread = t.thread();
  await thread.say(said);
  t.draftWrites({ observation: `Observed:\n${observation}` });
  return thread.create();
}

/** The live model: find_past_forms with the manager's words as evidence; the result it saw. */
function asks(input: Record<string, unknown>, said: string, seen: Out[]) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = view.results.find((entry) => entry.tool === "find_past_forms");
    if (!result) return { tool: "find_past_forms", input: { ...input, forms_on_file_evidence: evidenceFrom(view, said) } };
    seen.push(result.output as Out);
    return { text: "Here's what's on file." };
  });
}

async function seed(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  const cash = await caOnFile(t, "e-2", "ca for remy calder, cash handling at close", "Remy Calder left the cash drawer open at close; cash handling steps were skipped.");
  const dress = await caOnFile(t, "e-1", "ca for marnie holloway, dress code", "Marnie Holloway wore a hoodie on shift, against the dress code.");
  const elsewhere = await caOnFile(t, "e-4", "ca for rowan kestrel, dress code", "Rowan Kestrel wore ripped jeans on shift, against the dress code.");
  const late = await caOnFile(t, "e-3", "ca for juno paxton, late to open", "Juno Paxton opened the salon 20 minutes late.");
  /* Another salon's form: this salon director cannot see it in Form Monitoring, so it must never reach the model. */
  const moved = (t.forms() as Record<string, unknown>[]).find((row) => row.id === elsewhere)!;
  Object.assign(moved, { location_id: "loc-0307", location_name: "NE Grand Island" });
  vi.setSystemTime(new Date("2026-11-21T16:00:00Z"));
  return { cash, dress, elsewhere, late };
}

const topicCase = (id: string, title: string, run: (t: ReplayContext, made: Awaited<ReturnType<typeof seed>>) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: STATUS,
  fixFlags: FIX,
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await run(t, await seed(t));
  },
});

export const NOV21_AGENT_LOOP_FORM_TOPIC_SEARCH_CASES: ReplayCase[] = [
  topicCase("nov21-topic-cash-handling-this-month", "\"any forms about cash handling at my salons this month?\": Remy's cash-handling CA reaches the model (first name, counted 1 by code); the dress-code and lateness forms do not", async (t, made) => {
    const seen: Out[] = [];
    const said = "any forms about cash handling at my salons this month?";
    t.loopModel!(asks({ about: "cash handling", date_from: "2026-11-01", date_to: "2026-11-21" }, said, seen));
    await t.thread().say(said);
    const out = seen[0];
    expect(out?.forms?.map((entry) => entry.instance_id), JSON.stringify(out)).toEqual([made.cash]);
    expect(out?.forms?.[0]?.employee).toBe("Remy");
    expect(out?.counts).toMatchObject({ total: 1, people: 1 });
  }),
  topicCase("nov21-topic-dress-code-other-salon-never", "\"who's been written up for dress code?\": Marnie's dress-code CA reaches the model, and Rowan's at another salon (one this salon director cannot see) never does", async (t, made) => {
    const seen: Out[] = [];
    const said = "who's been written up for dress code?";
    t.loopModel!(asks({ about: "dress code", form: "CA" }, said, seen));
    await t.thread().say(said);
    const out = seen[0];
    const ids = out?.forms?.map((entry) => entry.instance_id) ?? [];
    expect(ids, JSON.stringify(out)).toContain(made.dress);
    expect(ids, "another salon's dress-code form reached the model").not.toContain(made.elsewhere);
    expect(JSON.stringify(out)).not.toMatch(/Rowan/);
    expect(out?.counts).toMatchObject({ total: 1, people: 1 });
  }),
];
