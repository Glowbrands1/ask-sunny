import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
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
const PREFERRED_REPORT = "QA, 15 Nov 2026: the manager typed the preferred first name, and the card showed only the legal name; Pau (~10:20 PHT): the card and form use the name the manager used, and the reply names the legal name once";
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
    title: "\"Create a CA for Rae Fairweather, she was late on 11/12\" (Lorraine, preferred Rae): the card is Rae Fairweather, and the reply names Lorraine Fairweather in Woven once",
    report: PREFERRED_REPORT,
    status: { open: "the reply and card show only the legal name, so it looks like another person" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Create a CA for Rae Fairweather, she was late on 11/12", { employeeName: "Rae Fairweather" });
      expect(thread.proposal?.employeeName, reply.content).toBe("Rae Fairweather");
      expect(reply.content).toContain("**Rae Fairweather** (Lorraine Fairweather in Woven)");
      expect(reply.content.split("Lorraine Fairweather").length - 1, "the legal name is said once").toBe(1);
    },
  },
  {
    id: "nov15-readable-names-preferred-name-saved",
    title: "Pau's ruling: the preferred name the manager typed IS the saved employee_name, for the same roster person",
    report: PREFERRED_REPORT,
    status: { open: "the form is saved under the legal name" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Create a CA for Rae Fairweather, she was late on 11/12", { employeeName: "Rae Fairweather" });
      const id = await thread.createCard!(thread.proposal?.employeeName ?? "");
      const form = t.forms().find((row) => row.id === id);
      expect(form?.employee_name).toBe("Rae Fairweather");
      expect(JSON.stringify(form)).not.toMatch(/Lorraine/);
    },
  },
  {
    id: "nov15-readable-names-legal-name-kept",
    title: "\"Create a CA for Lorraine Fairweather, she was late on 11/12\": the legal name typed is the card's and the form's, with no note",
    report: PREFERRED_REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Create a CA for Lorraine Fairweather, she was late on 11/12", { employeeName: "Lorraine Fairweather" });
      expect(thread.proposal?.employeeName, reply.content).toBe("Lorraine Fairweather");
      expect(reply.content).not.toContain("in Woven)");
    },
  },
  ...([
    ["saved-preferred-asked-legal", "Rae Fairweather", "open the CA for Lorraine Fairweather"],
    ["saved-legal-asked-preferred", "Lorraine Fairweather", "open the CA for Rae Fairweather"],
  ] as const).map(
    ([slug, savedAs, asked]): ReplayCase => ({
      id: `nov15-readable-names-lookup-${slug}`,
      title: `A CA saved as "${savedAs}" is found by "${asked}": one roster person, two names`,
      report: "QA, 15 Nov 2026: form_instances holds only employee_name; every by-name lookup reads the preferred and legal names as one person",
      status: { open: "the form saved under the other name is not found" },
      fixFlags: [FLAG, "REOPEN_BY_ANY_OPEN_VERB_ENABLED"],
      async run(t) {
        vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
        t.directory([...STAFF, LORRAINE]);
        t.as("salon_director", KEARNEY);
        const id = await caSavedAs(t, savedAs);
        const reply = await t.thread().say(asked);
        const opened = reply.formOpened as { instanceId: string; revisesInstanceId?: string | null } | undefined;
        expect([opened?.instanceId, opened?.revisesInstanceId], reply.content).toContain(id);
      },
    }),
  ),
];

/** QA's review of #1013: a second roster person whose legal name is Lorraine's preferred one (invented). */
const OTHER_RAE: DirectoryRow = { id: "e-rae-fairweather-rn", firstName: "Rae", lastName: "Fairweather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** QA's review of #1013: an all-caps roster row (invented). */
const LORRAINE_CAPS: DirectoryRow = { ...LORRAINE, firstName: "LORRAINE", lastName: "FAIRWEATHER", preferredFirstName: "RAE" };

export const NOV15_READABLE_NAMES_REVIEW_CASES: ReplayCase[] = [
  {
    id: "nov15-readable-names-review-two-people-never-merged",
    title: "QA's review: Lorraine Fairweather (preferred Rae) and another roster person, Rae Fairweather — asking for Lorraine never opens Rae's CA",
    report: "QA's independent review of #1013, 15 Nov 2026: the alias list only had people with a preferred name, so a legal Rae Fairweather was invisible and merged",
    status: "fixed",
    fixFlags: [FLAG, "REOPEN_BY_ANY_OPEN_VERB_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE, OTHER_RAE]);
      t.as("salon_director", KEARNEY);
      const id = await caSavedAs(t, "Rae Fairweather");
      const reply = await t.thread().say("open the CA for Lorraine Fairweather");
      const opened = reply.formOpened as { instanceId: string; revisesInstanceId?: string | null } | undefined;
      expect([opened?.instanceId, opened?.revisesInstanceId], reply.content).not.toContain(id);
    },
  },
  {
    id: "nov15-readable-names-review-all-caps-row",
    title: "QA's review: an all-caps roster row (LORRAINE FAIRWEATHER, preferred RAE) and \"Create a CA for rae fairweather\": \"Rae Fairweather\", never \"Rae FAIRWEATHER\"",
    report: "QA's independent review of #1013, 15 Nov 2026: all-caps rows gave \"Rae FAIRWEATHER (LORRAINE FAIRWEATHER in Woven)\"",
    status: { open: "the card shows the all-caps legal row, \"LORRAINE FAIRWEATHER\"" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE_CAPS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Create a CA for rae fairweather, she was late on 11/12", { employeeName: "rae fairweather" });
      expect(thread.proposal?.employeeName, reply.content).toBe("Rae Fairweather");
      expect(reply.content).toContain("**Rae Fairweather** (Lorraine Fairweather in Woven)");
      expect(reply.content).not.toMatch(/FAIRWEATHER/);
    },
  },
];

/** A Corrective Action saved under one of the person's names, in an earlier chat. */
async function caSavedAs(t: ReplayContext, name: string): Promise<string> {
  const earlier = t.thread();
  await earlier.say(`I need a corrective action for ${name}, she was late opening the salon on Monday`, { employeeName: name });
  t.draftWrites({ observation: "Observed:\nShe opened the salon late on Monday." });
  const id = await earlier.create();
  const row = t.forms().find((form) => form.id === id);
  if (row) row.employee_name = name;
  return id;
}
