import { expect, vi } from "vitest";

import { KEARNEY, STAFF, savedForm, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * NAMES READ AS THEY ARE WRITTEN, AND FOUND HOWEVER THEY ARE TYPED (READABLE_NAMES_ENABLED)
 * ============================================================================
 *
 * Pau, 15 Nov 2026 (via QA): "all naming conventions should be readable; some have de la Torre etc." A name typed off
 * the roster went on the card exactly as typed ("jacinta van der berg"), and a roster surname with spaces was not found
 * when typed without them ("maria delatorre"). With the flag: the typed name is readable on the card, and the
 * roster's spelling is found from the squashed one. A typo ("maria de la tore") is the one strong close match, as
 * today. Every person here is invented (on no directory).
 */

const MARIA: DirectoryRow = { id: "e-maria-delatorre-rn", firstName: "Maria", lastName: "de la Torre", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** QA, 15 Nov 2026: the typed first name was the employee's preferred first name in Woven (invented here). */
const LORRAINE: DirectoryRow = { id: "e-lorraine-fairweather-rn", firstName: "Lorraine", lastName: "Fairweather", preferredFirstName: "Rae", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const PREFERRED_REPORT = "QA, 15 Nov 2026: the manager typed the preferred first name, and the card showed only the legal name; Pau: forms show the legal name only, replies may say the preferred name with the legal name once";
const REPORT = "Pau via QA, 15 Nov 2026: \"all naming conventions should be readable; some have de la Torre etc.\"";
const LOOP = "AGENT_LOOP_ENABLED";
const FLAG = "READABLE_NAMES_ENABLED";

/** A loop model that looks the typed name up, then proposes the CA for whoever find_staff gave it. */
function writeUpModel(typed: string) {
  return loopStandIn((view) => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: typed } };
    const id = (lastResult(view, "find_staff")?.matches as { employee_id: string }[] | undefined)?.[0]?.employee_id;
    if (id && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: id, what_happened: "She was late." } };
    return { text: "Here's the draft." };
  });
}

export const NOV15_READABLE_NAMES_CASES: ReplayCase[] = [
  {
    id: "nov15-readable-names-loop-typo-uses-staff-list",
    title: "\"write up maria de la tore for being late\" (agent loop): the card is the roster's Maria de la Torre, with the \"Using … from your staff list\" fact",
    report: REPORT,
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARIA]);
      t.as("salon_director", KEARNEY);
      const model = writeUpModel("maria de la tore");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up maria de la tore for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Maria de la Torre");
      expect(JSON.stringify(lastResult(model.views.at(-1)!, "find_staff")), reply.content).toMatch(/"name_from_staff_list":"Maria de la Torre"/);
    },
  },
  {
    id: "nov15-readable-names-loop-squashed-surname",
    title: "\"write up maria delatorre for being late\" (agent loop): the surname typed without its spaces is the roster's Maria de la Torre",
    report: REPORT,
    // Already so with the flag off: the close-spelling check reads "delatorre" as the one strong match. With the flag it
    // is the roster's spelling outright.
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARIA]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(writeUpModel("maria delatorre"));
      const thread = t.thread();
      const reply = await thread.say("write up maria delatorre for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Maria de la Torre");
    },
  },
  {
    id: "nov15-readable-names-typed-off-roster",
    title: "\"create a ca for jacinta van der berg, she was late on 11/12\" (not on the roster): the card's name is \"Jacinta van der Berg\", not lowercase",
    report: REPORT,
    status: { open: "the name is cut at its particle (\"jacinta van\") and kept in lowercase" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARIA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      // The live model reads the name as typed; the stand-in is told so.
      let reply = await thread.say("create a ca for jacinta van der berg, she was late on 11/12", { employeeName: "jacinta van der berg" });
      // The card asks who the form is for; the answer is the name alone (and, if offered, the app's own "use <name>").
      if (!thread.proposal?.employeeName) reply = await thread.say("jacinta van der berg", { employeeName: "jacinta van der berg" });
      if (!thread.proposal?.employeeName && /reply \*\*use /.test(reply.content)) reply = await thread.say("use jacinta van der berg", { employeeName: "jacinta van der berg" });
      expect(thread.proposal?.employeeName, reply.content).toBe("Jacinta van der Berg");
    },
  },
  {
    id: "nov15-readable-names-preferred-name-said-back",
    title: "\"Create a CA for Rae Fairweather, she was late on 11/12\" (Lorraine, preferred Rae): the reply says \"Rae Fairweather (Lorraine Fairweather in Woven)\" once; the card and the form keep the legal name",
    report: PREFERRED_REPORT,
    status: { open: "the reply and card show only the legal name, so it looks like another person" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Create a CA for Rae Fairweather, she was late on 11/12", { employeeName: "Rae Fairweather" });
      expect(thread.proposal?.employeeName, reply.content).toBe("Lorraine Fairweather");
      expect(reply.content).toContain("Rae Fairweather (**Lorraine Fairweather** in Woven)");
      expect(reply.content.split("Rae Fairweather").length - 1, "the preferred name is said once").toBe(1);
      expect((thread.proposal as { wovenCloseMatch?: string | null } | undefined)?.wovenCloseMatch).toBe("Rae Fairweather is Lorraine Fairweather in Woven; the form uses the legal name.");
    },
  },
  {
    id: "nov15-readable-names-preferred-name-never-saved",
    title: "Pau's ruling: a preferred name typed in chat never reaches employee_name or any other saved form field",
    report: PREFERRED_REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Create a CA for Rae Fairweather, she was late on 11/12", { employeeName: "Rae Fairweather" });
      const id = await thread.createCard!("Lorraine Fairweather");
      const form = t.forms().find((row) => row.id === id);
      expect(form?.employee_name).toBe("Lorraine Fairweather");
      expect(savedForm(t, id)).not.toMatch(/Rae Fairweather|\bRae\b/);
    },
  },
  {
    id: "nov15-readable-names-loop-preferred-name",
    title: "\"write up rae fairweather for being late\" (agent loop; Lorraine, preferred Rae): the card is the legal name, and find_staff tells the model to say the preferred name with it once",
    report: PREFERRED_REPORT,
    status: { open: "find_staff gives only the legal name" },
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const model = writeUpModel("rae fairweather");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up rae fairweather for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Lorraine Fairweather");
      expect(String(lastResult(model.views.at(-1)!, "find_staff")?.preferred_name_note ?? "")).toContain("Rae Fairweather (Lorraine Fairweather in Woven)");
    },
  },
];
