import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE REBUILD PLAN'S PR 1: WORD LISTS BECOME EVIDENCE (owner's audit, 15 Nov 2026)
 * ============================================================================
 *
 * The model's tool arguments are claims; code checks the manager's quoted words are really in their messages
 * (`evidence.ts`) and never reads what the words mean. Each case is a guard that a word list used to hold, now held by
 * evidence. Invented names only (Remy Calder, Juno Paxton).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's rebuild plan (owner's audit, 15 Nov 2026), PR 1";

/** Remy Calder's Corrective Action draft, created in its own chat; returns its id. */
async function remysDraft(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
  const thread = t.thread();
  await thread.say("CA for Remy Calder, she was late to her shift on 11/14");
  return thread.create();
}

export const NOV15_PR1_EVIDENCE_CASES: ReplayCase[] = [
  {
    id: "nov15-pr1-edit-a-form-on-file-needs-the-managers-ask",
    title: "PR 1 (rebuild plan bug 2: edit_form had no privacy gate): in a new chat with no form open, edit_form on Remy's saved draft without forms_on_file_evidence is refused (privacy_not_asked) and writes nothing; with the manager's own ask quoted, it writes",
    report: `${REPORT}: bug 2, edit_form of a form that is not open had no privacy check`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const id = await remysDraft(t);
      const before = JSON.stringify(t.values(id));
      const unasked = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { reason_code?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { observation: "She was late to her shift on 11/14 and was rude to a guest." } } };
        return { text: edit.reason_code === "privacy_not_asked" ? "I can only work from what you tell me here." : "Updated." };
      });
      t.loopModel!(unasked);
      const other = t.thread();
      const refused = await other.say("she was rude to a guest today");
      expect(JSON.stringify(t.values(id)), "a form on file was edited although the manager never asked about it").toBe(before);
      expect(refused.content).toBe("I can only work from what you tell me here.");
      const asked = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { reason_code?: string; updated?: string[] } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { observation: "She was late to her shift on 11/14 and was rude to a guest." }, forms_on_file_evidence: evidenceFrom(view, "edit remy calder's ca") } };
        return { text: edit.updated?.length ? "Updated Remy Calder's Corrective Action Form." : "Nothing changed." };
      });
      t.loopModel!(asked);
      await t.thread().say("edit remy calder's ca: she was also rude to a guest");
      expect(t.values(id).observation ?? "", "the manager's own ask did not open the form on file").toMatch(/rude to a guest/);
    },
  },
  {
    id: "nov15-pr1-past-forms-need-the-managers-own-words",
    title: "PR 1: find_past_forms with evidence quoting words the manager never typed is refused (privacy_not_asked, evidence_quote_not_found); quoting the manager's \"has she had any write ups before\" lists the forms",
    report: `${REPORT}: ASKS_ABOUT_FORMS and asksAboutPastForms (tools.ts:119-158) replaced by forms_on_file_evidence`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await remysDraft(t);
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { forms?: unknown[]; reason_code?: string; evidence?: string } | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", forms_on_file_evidence: evidenceFrom(view, "show me all her write ups") } };
        if (found.reason_code === "privacy_not_asked" && view.results.filter((result) => result.tool === "find_past_forms").length === 1) {
          return { tool: "find_past_forms", input: { employee_name: "Remy Calder", forms_on_file_evidence: evidenceFrom(view, "had any write ups before") } };
        }
        return { text: `${found.forms?.length ?? 0} on file.` };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("has remy calder had any write ups before?");
      const first = model.views.flatMap((view) => view.results).find((result) => result.tool === "find_past_forms")!.output as { reason_code?: string; evidence?: string };
      expect(first).toMatchObject({ reason_code: "privacy_not_asked", evidence: "evidence_quote_not_found" });
      expect(reply.content).toBe("1 on file.");
    },
  },
  {
    id: "nov15-pr1-privacy-ask-is-about-this-person",
    title: "PR 1a review (QA, ruling 1): \"write a new form for Remy Calder…\" quoted as forms_on_file_evidence never opens Juno Paxton's forms (privacy_not_this_person); the same words open Remy Calder's",
    report: `${REPORT}: QA's review of #1026, ruling 1 (privacy evidence is tied to the person)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await remysDraft(t);
      const model = loopStandIn((view): LoopDecision => {
        const looks = view.results.filter((result) => result.tool === "find_past_forms");
        if (looks.length === 0) return { tool: "find_past_forms", input: { employee_name: "Juno Paxton", forms_on_file_evidence: evidenceFrom(view, "new form") } };
        if (looks.length === 1) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", forms_on_file_evidence: evidenceFrom(view, "new form for Remy Calder") } };
        return { text: "Done." };
      });
      t.loopModel!(model);
      await t.thread().say("write a new form for Remy Calder, she was late to her shift on 11/14");
      const [juno, remy] = model.views.at(-1)!.results.filter((result) => result.tool === "find_past_forms").map((result) => result.output) as { reason_code?: string; forms?: unknown[] }[];
      expect(juno, "another person's forms opened on this person's request").toMatchObject({ reason_code: "privacy_not_this_person" });
      expect(remy?.reason_code, "the person the manager named stayed closed").toBeUndefined();
    },
  },
  {
    id: "nov15-pr1-only-a-quoted-name-correction-renames",
    title: "PR 1a review (QA, ruling 2): \"fix her last name please\" with employee_name \"Juno Paxton\" on Remy Calder's draft is refused (no evidence: name_evidence_missing; evidence without the name: name_not_in_evidence); the form keeps Remy Calder",
    report: `${REPORT}: QA's review of #1026, ruling 2 (every employee_name write is a quoted name correction)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      }));
      const thread = t.thread();
      await thread.say("CA for Remy Calder, she was late to her shift on 11/14");
      const id = await thread.create();
      const before = JSON.stringify(t.values(id));
      const model = loopStandIn((view): LoopDecision => {
        const edits = view.results.filter((result) => result.tool === "edit_form");
        if (edits.length === 0) return { tool: "edit_form", input: { instance_id: id, values: { employee_name: "Juno Paxton" } } };
        if (edits.length === 1) return { tool: "edit_form", input: { instance_id: id, values: { employee_name: "Juno Paxton" }, name_evidence: evidenceFrom(view, "fix her last name please") } };
        return { text: (edits.map((edit) => (edit.output as { reason_code?: string }).reason_code)).join(", ") };
      });
      t.loopModel!(model);
      const reply = await thread.say("fix her last name please");
      expect(reply.content).toBe("name_evidence_missing, name_not_in_evidence");
      expect(JSON.stringify(t.values(id)), "the form's name was changed").toBe(before);
    },
  },
  {
    id: "nov15-pr1-a-card-never-opens-another-named-persons-forms",
    title: "PR 1a re-review (QA, fix 1): with Juno Paxton's card shown, \"has Remy Calder had a CA before?\" quoted as evidence never opens Juno Paxton's forms (privacy_not_this_person); the card fallback is only for a message that names nobody",
    report: `${REPORT}: QA's re-review of #1026, fix 1`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
        return { text: "Here's the Corrective Action Form for **Juno Paxton**.\n\n**Observation of Offense:** She was late to her shift on 11/14." };
      }));
      const thread = t.thread();
      await thread.say("CA for Juno Paxton, she was late to her shift on 11/14");
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { reason_code?: string } | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Juno Paxton", forms_on_file_evidence: evidenceFrom(view, "had a CA before") } };
        return { text: found.reason_code ?? "listed" };
      });
      t.loopModel!(model);
      const reply = await thread.say("has Remy Calder had a CA before?");
      expect(reply.content, "the card's person's forms opened on a question about someone else").toBe("privacy_not_this_person");
    },
  },
  {
    id: "nov15-pr1-name-correction-changes-only-the-name",
    title: "PR 1: \"fix her last name, it is Calder-Voss\" on the open draft is edit_form intent correct_name: with another field too it is refused (name_correction_other_fields), with no name_evidence it is refused (name_evidence_missing), and nothing else is written",
    report: `${REPORT}: NAME_CORRECTION (tools.ts:2348) replaced by intent correct_name + name_evidence`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      }));
      const thread = t.thread();
      await thread.say("CA for Remy Calder, she was late to her shift on 11/14");
      const id = await thread.create();
      const before = JSON.stringify(t.values(id));
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "edit_form").map((result) => result.output as { reason_code?: string });
        if (results.length === 0) return { tool: "edit_form", input: { instance_id: id, intent: "correct_name", name_evidence: evidenceFrom(view, "it is Calder-Voss"), values: { employee_name: "Remy Calder-Voss", observation: "She was late." } } };
        if (results.length === 1) return { tool: "edit_form", input: { instance_id: id, intent: "correct_name", values: { employee_name: "Remy Calder-Voss" } } };
        return { text: results.map((result) => result.reason_code).join(", ") };
      });
      t.loopModel!(model);
      const reply = await thread.say("fix her last name, it is Calder-Voss");
      expect(reply.content).toBe("name_correction_other_fields, name_evidence_missing");
      expect(JSON.stringify(t.values(id)), "a refused name correction wrote something").toBe(before);
    },
  },
  {
    id: "nov15-pr1-a-one-word-name-the-manager-typed-is-offered-c134",
    title: "PR 1 (the old K3 person slot, QA's shadow replay c134's shape): \"put together an exit for Wrenna\", nobody on the roster, with person_evidence holding the name gets \"Reply **use Wrenna**\"; \"use Wrenna\" makes the Exit card for Wrenna; without the evidence it stays \"not a person's name\"",
    report: `${REPORT}: QA's 266 shadow replay, c134 and the B group (an off-roster first name was never offered)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const staff = lastResult(view, "find_staff") as { note?: string } | null;
        if (/^use wrenna/i.test(said)) {
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_name: "Wrenna", effective_date: "11/14", exit_evidence: evidenceFrom(view, "put together an exit for Wrenna", 1) } };
          return { text: "Here's the Employee Exit Form for **Wrenna**." };
        }
        if (!staff) return { tool: "find_staff", input: { name: "Wrenna", person_evidence: evidenceFrom(view, "an exit for Wrenna") } };
        const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
        return { text: asked ?? "Who is this Resignation/Exit Form for?" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const offer = await thread.say("put together an exit for Wrenna");
      expect(offer.content, `no use-<name> offer:\n${offer.content}`).toContain("Reply **use Wrenna**");
      await thread.say("use Wrenna");
      expect(thread.proposal?.employeeName, "the exit was not carded for the name as typed").toBe("Wrenna");
    },
  },
  {
    id: "nov15-pr1b-k8-exit-asked-before-the-name-correction-c219",
    title: "K8 (QA's shadow replay, c219's shape; ruling (a)): \"I need an exit form with this information\" typed under \"Tesa Varnel\", the app asks, then \"For Tessa Varnell\": with request_evidence citing the earlier messages, the exit card is made on the T2 evidence; without it, exit_not_stated",
    report: `${REPORT}: QA's 266 shadow replay, c219 (the explicit exit request was ignored after the name correction)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        if (!/^For Tessa Varnell/.test(said)) return { text: "I can't find **Tesa Varnel** on your staff list. Give me her full name, or reply **use Tesa Varnel**." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Tessa Varnell" } };
        const card = lastResult(view, "propose_form") as { exit_not_stated?: boolean } | null;
        if (!card) {
          return {
            tool: "propose_form",
            input: {
              template_key: "stc-exit",
              employee_name: "Tessa Varnell",
              effective_date: "11/14",
              exit_evidence: evidenceFrom(view, "I need an exit form with this information", 1),
              request_evidence: [evidenceFrom(view, "Meeting with Tesa Varnel tomorrow", 2), evidenceFrom(view, "I need an exit form with this information", 1)],
            },
          };
        }
        return { text: card.exit_not_stated ? "No exit asked." : "Here's the Employee Exit Form for **Tessa Varnell**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("Meeting with Tesa Varnel tomorrow at 7:30am about the text she sent her salon director on 11/13.");
      await thread.say("I need an exit form with this information. Tesa Varnel is being terminated.");
      const reply = await thread.say("For Tessa Varnell");
      expect(thread.proposal?.templateKey, `the exit asked for before the name correction was lost:\n${reply.content}`).toBe("stc-exit");
      expect(thread.proposal?.employeeName).toBe("Tessa Varnell");
    },
  },
  {
    id: "nov15-pr1b-k8-another-persons-turn-is-never-this-request",
    title: "K8, QA's guardrail: request_evidence citing a message about Juno Paxton (a roster person) on Tessa Varnell's card is refused (request_evidence_other_person) and nothing is proposed",
    report: `${REPORT}: QA's K8 guardrails (a cited turn naming another roster person is refused)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        if (!/Tessa Varnell/.test(said)) return { text: "Noted." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Tessa Varnell" } };
        const card = lastResult(view, "propose_form") as { reason_code?: string } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Tessa Varnell", what_happened: "She was late again on 11/14.", request_evidence: [evidenceFrom(view, "Juno Paxton was late again", 1)] } };
        return { text: card.reason_code ?? "proposed" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("Juno Paxton was late again on 11/14");
      const reply = await thread.say("make a CA for Tessa Varnell, she was late again on 11/14");
      expect(reply.content).toBe("request_evidence_other_person");
      expect(thread.proposal ?? null, "a card was made from another person's turn").toBeNull();
    },
  },
  {
    id: "nov15-pr1b-open-with-none-on-file-still-proposes",
    title: "PR 1b review (QA, ruling 3): find_past_forms open: true for Remy Calder finds none on file, so propose_form stays allowed and the CA card is made",
    report: `${REPORT}: QA's review of #1029, ruling 3 (an open request withdraws or refuses a card only after forms are found, for the same person)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", open: true, forms_on_file_evidence: evidenceFrom(view, "open remy calder's last ca") } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
        return { text: "None on file, so here's a new Corrective Action Form for **Remy Calder**." };
      }));
      const thread = t.thread();
      const reply = await thread.say("open remy calder's last ca, if there isn't one make a new one: she was late to her shift on 11/14");
      expect(thread.proposal, `no card after "None on file":\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
    },
  },
  {
    id: "nov15-pr1b-request-evidence-is-this-request-only",
    title: "PR 1b review (QA, ruling 4): request_evidence citing a turn from before the manager turned to Juno Paxton is refused (request_evidence_not_this_request) and nothing is proposed",
    report: `${REPORT}: QA's review of #1029, ruling 4 (a recency window: the same request only)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        if (!/Tessa Varnell/.test(said)) return { text: "Noted." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Tessa Varnell" } };
        const card = lastResult(view, "propose_form") as { reason_code?: string } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Tessa Varnell", what_happened: "She left the beds dirty on 11/12.", request_evidence: [evidenceFrom(view, "she left the beds dirty", 2)] } };
        return { text: card.reason_code ?? "proposed" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("she left the beds dirty on 11/12");
      await thread.say("Juno Paxton was late again on 11/13");
      const reply = await thread.say("make a CA for Tessa Varnell");
      expect(reply.content).toBe("request_evidence_not_this_request");
      expect(thread.proposal ?? null, "a card was made from an earlier request's turn").toBeNull();
    },
  },
  {
    id: "nov15-pr1b-person-evidence-is-whole-words",
    title: "PR 1b review (QA, ruling 7): person_evidence \"an exit for Wrenna\" does not hold \"Wren\" (whole words), and a job title (\"Salon Director\") is never offered as a name: no use-<name> offer",
    report: `${REPORT}: QA's review of #1029, ruling 7 (whole-word match, title words rejected)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      for (const [name, quote, said] of [["Wren", "an exit for Wrenna", "put together an exit for Wrenna"], ["Salon Director", "for the Salon Director", "make a coaching form for the Salon Director"]] as const) {
        const model = loopStandIn((view): LoopDecision => {
          const staff = lastResult(view, "find_staff") as { not_on_roster?: string } | null;
          if (!staff) return { tool: "find_staff", input: { name, person_evidence: evidenceFrom(view, quote) } };
          return { text: staff.not_on_roster ? `offered ${staff.not_on_roster}` : "not offered" };
        });
        t.loopModel!(model);
        const reply = await t.thread().say(said);
        expect(reply.content, `"${name}" was offered as a name`).toBe("not offered");
      }
    },
  },
];
