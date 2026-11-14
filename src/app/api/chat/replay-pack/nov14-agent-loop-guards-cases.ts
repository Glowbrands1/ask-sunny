import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { firstMatch, lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE AGENT LOOP'S HARD GUARDS (AGENT_LOOP_ENABLED; QA and Pau, 14 Nov 2026)
 * ============================================================================
 *
 * Pau agreed the design: the details are taught to the model (the rules book, `agent-loop/rules-book.ts`), and only
 * the hard safety rules stay in code (`agent-loop/tools.ts`). Each case here gives the loop a careless stand-in model
 * that tries to break one guard, and asserts the code holds whatever the model does:
 *
 *   privacy        forms on file are never looked at, or mentioned, unless the manager asked (a finalized
 *                  Termination on file is never brought up); asked, they are
 *   level/payroll  a warning level or payroll deduct the manager did not state never reaches the card
 *   one card       the screen shows one card per reply; a second person's form is offered, never a card naming two
 *   scope          a person at a salon outside the manager's scope is never found or carded
 *   finalized      a change to a finalized form opens a new draft revising it; the original is byte-identical
 *
 * All people invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, 14 Nov 2026 (Pau's hard guards for the agent loop)";

const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CORBIN: DirectoryRow = { id: "e-corbin-ashdown", firstName: "Corbin", lastName: "Ashdown", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** At a salon outside the signed-in manager's scope. */
const FARAWAY: DirectoryRow = { id: "e-ysolde-marchetti", firstName: "Ysolde", lastName: "Marchetti", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-9917"], positionName: "Tanning Consultant" };

const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));

/** A finalized Corrective Action with Termination ticked, on file for Tamsin. */
async function terminationOnFile(t: ReplayContext): Promise<string> {
  const careful = loopStandIn((view) => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Tamsin Orwell did not come in for three scheduled shifts." } };
    return { text: "Here is the Corrective Action Form." };
  });
  if (t.loopOn?.()) t.loopModel!(careful);
  const thread = t.thread();
  await thread.say("termination ca for tamsin orwell, she did not come in for three scheduled shifts");
  t.draftWrites({ observation: "Observed:\nTamsin Orwell did not come in for three scheduled shifts." }, { warning_type: ["termination"] });
  const id = await thread.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-02" });
  return id;
}

/** A model that looks at forms on file whenever it can, and tells the manager what it found. */
function nosyStandIn(view: LoopView) {
  if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Tamsin Orwell" } };
  const listed = (lastResult(view, "find_past_forms")?.forms ?? []) as { instance_id: string; form: string; status: string }[];
  if (listed.length > 0 && !lastResult(view, "read_form")) return { tool: "read_form", input: { instance_id: listed[0]!.instance_id } };
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
  if (!/before|on file/i.test(view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "") && !lastResult(view, "propose_form")) {
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Tamsin Orwell was on her phone at the front desk on 11/13." } };
  }
  const seen = [lastResult(view, "find_past_forms"), lastResult(view, "read_form")].map((result) => JSON.stringify(result ?? {})).join(" ");
  return { text: `Here is what I found: ${seen}` };
}

export const NOV14_AGENT_LOOP_GUARD_CASES: ReplayCase[] = [
  {
    id: "nov14-agent-loop-guard-privacy-termination-not-asked",
    title: "privacy: a card for a person with a finalized Termination on file says nothing about it; forms on file are looked at only when the manager asks",
    report: `${REPORT}: "past forms are never shown unless the manager asked for them"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      await terminationOnFile(t);

      const nosy = loopStandIn(nosyStandIn);
      t.loopModel!(nosy);
      const thread = t.thread();
      const reply = await thread.say("create a ca for tamsin orwell, she was on her phone at the front desk on 11/13");
      expect(thread.proposal, reply.content).toMatchObject({ templateKey: "dpoa", employeeName: "Tamsin Orwell" });
      for (const output of [...toolResults(nosy.views, "find_past_forms"), ...toolResults(nosy.views, "read_form")]) {
        expect(output, "a form on file was read without the manager asking").toMatch(/not asked about forms on file/);
      }
      expect(reply.content, "the Termination on file was brought up").not.toMatch(/terminat/i);
      expect(JSON.stringify(thread.proposal), "the Termination on file reached the card").not.toMatch(/terminat/i);

      // Asked, the forms on file are looked at.
      const asked = await thread.say("has she had a ca before?");
      expect(asked.content, "asked about history, the forms on file were not looked at").toMatch(/Corrective Action/);
    },
  },
  {
    id: "nov14-agent-loop-guard-privacy-incident-wording-stays-closed",
    title: "privacy: QA's probe sentences, ordinary incident wording (\"before\", \"records\", \"a history of\", \"did she get a\", \"last time\"), never open forms on file; a request naming them does",
    report: `${REPORT}; QA's review of #992 (14 Nov 2026): the gate opened on incident wording`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      await terminationOnFile(t);
      const closed = [
        "ca for tamsin orwell, she left before closing and didnt clean the beds",
        "ca for tamsin orwell, she didnt record the lotion sales",
        "did she get a break today? tamsin orwell was rude to a client",
        "ca for tamsin orwell, she said she has a history of migraines and left early",
        "tamsin orwell clocked in 20 min late, she was told before about being on time",
        "need a ca for tamsin orwell, last time i told her no phone",
        "do a coaching for tamsin orwell she was late tuesday",
      ];
      for (const said of closed) {
        const nosy = loopStandIn(nosyStandIn);
        t.loopModel!(nosy);
        const reply = await t.thread().say(said);
        for (const output of [...toolResults(nosy.views, "find_past_forms"), ...toolResults(nosy.views, "read_form")]) {
          expect(output, `"${said}" opened forms on file`).toMatch(/not asked about forms on file/);
        }
        expect(reply.content, `"${said}": the Termination on file was brought up`).not.toMatch(/terminat/i);
      }
      for (const said of ["has tamsin orwell had any write ups", "change the date on my last CA for tamsin orwell"]) {
        const nosy = loopStandIn(nosyStandIn);
        t.loopModel!(nosy);
        await t.thread().say(said);
        expect(toolResults(nosy.views, "find_past_forms")[0], `"${said}" did not open forms on file`).not.toMatch(/not asked about forms on file/);
      }
    },
  },
  {
    id: "nov14-agent-loop-guard-no-invented-level-or-payroll",
    title: "no invented warning level or payroll: a level or payroll deduct the manager did not state never reaches the card; stated, it does",
    report: `${REPORT}: "no invented warning level or payroll"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const eager = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
        if (!lastResult(view, "propose_form")) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Tamsin Orwell was 30 minutes late on 11/12.", warning_level: "written", payroll_deduct: "yes", payroll_amount: "50" } };
        }
        return { text: "Here is the Corrective Action Form." };
      });
      t.loopModel!(eager);
      const unstated = t.thread();
      await unstated.say("ca for tamsin orwell, she was 30 minutes late on 11/12");
      expect(unstated.proposal?.warningLevel ?? null, "a level nobody stated is on the card").toBeNull();
      expect((unstated.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct ?? null, "payroll nobody stated is on the card").toBeNull();

      const stated = t.thread();
      await stated.say("written ca for tamsin orwell, she was 30 minutes late on 11/12, payroll deduct $50");
      expect(stated.proposal?.warningLevel, "the stated level was dropped").toBe("written");
      expect(stated.proposal as unknown, "the stated payroll was dropped").toMatchObject({ payrollDeduct: "yes", payrollDeductAmount: "50" });
    },
  },
  {
    id: "nov14-agent-loop-guard-one-card-per-reply",
    title: "two people in one request: one card per reply, each person's own; never a second card in the same reply",
    report: `${REPORT}: multiple people (TWO_FORMS_EACH_PERSON's outcome)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN, CORBIN]);
      t.as("salon_director", KEARNEY);
      const both = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
        const proposals = view.results.filter((result) => result.tool === "propose_form").length;
        if (proposals === 0) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, what_happened: "Tamsin Orwell was late on 11/3/26." } };
        if (proposals === 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: CORBIN.id, what_happened: "Corbin Ashdown was late on 11/3/26." } };
        return { text: "Here is Tamsin Orwell's card. Want me to start Corbin Ashdown's next?" };
      });
      t.loopModel!(both);
      const thread = t.thread();
      const reply = await thread.say("make a ca for tamsin orwell and corbin ashdown, they were both late on 11/3/26");
      expect(thread.proposal?.employeeName, reply.content).toBe("Tamsin Orwell");
      expect(toolResults(both.views, "propose_form").at(-1), "a second card was made in the same reply").toMatch(/already shown in this reply/);
    },
  },
  {
    id: "nov14-agent-loop-guard-open-draft-keeps-turns",
    title: "with a draft open, \"I talked to her about it last week\" never gets a second card for the same form and person; \"another CA\" may, and \"the same form for <C>\" gives C a card",
    report: `${REPORT}; OPEN_DRAFT_KEEPS_TURNS (2 Nov scan: the second draft lost what the manager typed)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN, CORBIN]);
      t.as("salon_director", KEARNEY);
      const again = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, what_happened: "Tamsin Orwell was on her phone at the front desk." } };
        return { text: JSON.stringify(lastResult(view, "propose_form")) };
      });
      t.loopModel!(again);
      const thread = t.thread();
      await thread.say("ca for tamsin orwell, she was on her phone at the front desk");
      t.draftWrites({ observation: "Observed:\nTamsin Orwell was on her phone at the front desk." }, {});
      await thread.create();
      const before = t.forms().length;
      const reply = await thread.say("I talked to her about it last week");
      expect(reply.formProposal, `a second card for the open draft:\n${reply.content}`).toBeUndefined();
      expect(reply.content).toMatch(/is open on screen: put this on that draft with edit_form/);
      expect(t.forms().length).toBe(before);
      const another = await thread.say("make another ca for tamsin orwell, she was late on 11/12");
      expect(another.formProposal?.templateKey, "\"another\" was refused").toBe("dpoa");

      // Multi-person (QA, 14 Nov 2026): another person always gets their own card, the draft open or not.
      const corbin = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "corbin ashdown" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: CORBIN.id, what_happened: "Corbin Ashdown was on his phone at the front desk." } };
        return { text: "Here is Corbin Ashdown's card." };
      });
      t.loopModel!(corbin);
      const same = await thread.say("the same form for corbin ashdown");
      expect(same.formProposal?.employeeName, `the same form for another person was refused:\n${same.content}`).toBe("Corbin Ashdown");
    },
  },
  {
    id: "nov14-agent-loop-guard-off-roster-only-when-confirmed",
    title: "roster identity: a name not in Woven goes on a card only after the app offered \"reply **use <name>**\" and the manager said so",
    report: `${REPORT}; OFF_ROSTER_CONFIRM's outcome (a person not in Woven yet can still get a form)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const typed = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Perpetua Vandersloot" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Perpetua Vandersloot", what_happened: "Perpetua Vandersloot was late on 11/12." } };
        return { text: String(lastResult(view, "find_staff")?.note ?? "") };
      });
      t.loopModel!(typed);
      const thread = t.thread();
      const first = await thread.say("ca for Perpetua Vandersloot, she was late on 11/12");
      expect(thread.proposal ?? null, "an unconfirmed off-roster name was carded").toBeNull();
      expect(first.content, first.content).toMatch(/reply \*\*use Perpetua Vandersloot\*\*/);
      await thread.say("use Perpetua Vandersloot");
      expect(thread.proposal?.employeeName, "the confirmed name was refused").toBe("Perpetua Vandersloot");
    },
  },
  {
    id: "nov14-agent-loop-prompt-cache-markers",
    title: "prompt caching: every step carries two cache markers, the rules (system) and the step's last message, which moves forward as tool results arrive",
    report: `${REPORT}; QA, 14 Nov 2026: a 9% prompt-cache hit rate`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const stepping = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwell" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, what_happened: "Tamsin Orwell was late on 11/12." } };
        return { text: "Here is the card." };
      });
      t.loopModel!(stepping);
      await t.thread().say("ca for tamsin orwell, she was late on 11/12");
      type Sent = { role: string; providerOptions?: { anthropic?: { cacheControl?: { type?: string } } } };
      const marked = (message: Sent) => message.providerOptions?.anthropic?.cacheControl?.type === "ephemeral";
      expect(stepping.prompts.length, "the loop took fewer than three steps").toBe(3);
      for (const [step, prompt] of (stepping.prompts as Sent[][]).entries()) {
        const markers = prompt.map((message, index) => (marked(message) ? index : -1)).filter((index) => index >= 0);
        expect(marked(prompt[0]!), `step ${step}: the rules (first system message) carry no cache marker`).toBe(true);
        expect(prompt[0]!.role).toBe("system");
        expect(marked(prompt[prompt.length - 1]!), `step ${step}: the last message carries no cache marker`).toBe(true);
        expect(markers, `step ${step}: markers other than the rules and the last message`).toEqual([0, prompt.length - 1]);
      }
      expect((stepping.prompts as Sent[][])[2]!.at(-1)!.role, "step 3's marker is not on the latest tool result").toBe("tool");
    },
  },
  {
    id: "nov14-agent-loop-guard-scope",
    title: "scope: a person at a salon outside the manager's scope is never found by find_staff, and propose_form refuses their roster id",
    report: `${REPORT}: "every tool is scoped to the manager's salons"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN, FARAWAY]);
      t.as("salon_director", KEARNEY);
      const reaching = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "ysolde marchetti" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: FARAWAY.id, what_happened: "Ysolde Marchetti was late." } };
        return { text: "Done." };
      });
      t.loopModel!(reaching);
      const thread = t.thread();
      await thread.say("ca for ysolde marchetti, she was late");
      expect(toolResults(reaching.views, "find_staff")[0], "a person outside the manager's salons was found").toMatch(/"matches":\[\]/);
      expect(toolResults(reaching.views, "propose_form")[0], "a person outside the manager's salons was carded").toMatch(/employee_id find_staff returned/);
      expect(thread.proposal ?? null).toBeNull();
    },
  },
  {
    id: "nov14-agent-loop-guard-finalized-change-is-a-revision",
    title: "\"change the date on my last CA for <A> to 11/4\" with a finalized CA on file: a new draft revising it carries the date; the finalized form is byte-identical",
    report: `${REPORT}: finished forms are changed through the Edit button's revision path, never in place`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const id = await terminationOnFile(t);
      const before = JSON.stringify({ form: t.forms().find((row) => row.id === id), values: t.values(id) });

      const editor = loopStandIn((view) => {
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Tamsin Orwell" } };
        const listed = (lastResult(view, "find_past_forms")?.forms ?? []) as { instance_id: string }[];
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: listed[0]?.instance_id ?? "" } };
        return { text: "Done." };
      });
      t.loopModel!(editor);
      const reply = await t.thread().say("change the date on my last CA for tamsin orwell to 11/4");
      expect(JSON.stringify({ form: t.forms().find((row) => row.id === id), values: t.values(id) }), "the finalized form changed").toBe(before);
      expect(reply.formOpened?.revisesInstanceId, reply.content).toBe(id);
      const revision = (t.forms() as { id: string; status: string; form_date?: string; revises_instance_id?: string | null }[]).find((row) => row.revises_instance_id === id);
      expect(revision?.status, `no draft revising it:\n${reply.content}`).toBe("draft");
      expect(revision?.form_date ?? t.values(revision!.id).form_date, `the revision's date:\n${reply.content}`).toBe("2026-11-04");
      expect(reply.content, "the reply does not say it is a new draft").toMatch(/new draft/i);
    },
  },
];
