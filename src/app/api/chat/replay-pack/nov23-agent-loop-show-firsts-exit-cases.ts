import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "SHOW ME <FIRST>SEXIT" OPENS HER ONE EXIT FORM (a live manager, 23 Nov 2026; Pau's review via QA; high: the form never opened)
 * ============================================================================
 *
 * The manager's words, verbatim but for the name: T1 "show me <first>sexit" (the possessive typed with no apostrophe and
 * no space). Sunny asked "Just to confirm — do you want to see <First>'s Resignation/Exit Form on file?", then, after
 * "yes", asked again whose it was, then, after "yes", listed all 11 of her forms; T4 "11202026" was answered "11/20
 * matches both the Coaching Form draft and the Resignation/Exit Form". She gave up; the form never opened.
 *
 * The trace: find_past_forms was refused privacy_not_this_person ("<first>sexit" named nobody), then open_form the same
 * twice, then which_form_not_chosen twice; "exit" never narrowed the forms (find_past_forms read only coaching and CA
 * from `form`), and "11202026" read as no date. Expected (QA): one exit form on file opens at once; several, only the exit
 * forms are listed; a date answer picks the one with that form date. Invented person: Tirzah Quillon.
 */

const REPORT = "A live manager (23 Nov 2026, Pau's review via QA): \"show me <first>sexit\" asked twice whose it was, listed all 11 of her forms, and \"11202026\" did not pick the exit form; it never opened";
const TIRZAH: DirectoryRow = { id: "e-tirzah-quillon", firstName: "Tirzah", lastName: "Quillon", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "show me tirzahsexit";

type Found = { forms?: { instance_id?: string; form?: string; form_date?: string }[]; which_form_question?: string; reason_code?: string; error?: string };

/** Tirzah's forms on file, as Form Monitoring holds them: Corrective Actions, Coachings (one a draft on the exit's date) and her exit form(s). */
function onFile(t: ReplayContext, exits: readonly string[]): void {
  const row = (id: string, key: string, name: string, formDate: string, status = "finalized") => ({
    id, ...t.templateIds!(key), variant_key: null, employee_role: null,
    location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney", created_by: "another-manager", created_by_role: "salon_director",
    source: "ask_sunny", status, follow_up_date: null, archived_at: null, revises_instance_id: null,
    template_key: key, template_name: name, employee_name: "Tirzah Quillon", form_date: formDate,
    created_at: `${formDate}T15:00:00Z`, updated_at: `${formDate}T15:00:00Z`,
  });
  (t.forms() as Record<string, unknown>[]).push(
    row("ca-tirzah-1107", "dpoa", "Corrective Action Form", "2026-11-07", "draft"),
    row("ca-tirzah-1111", "dpoa", "Corrective Action Form", "2026-11-11"),
    row("ca-tirzah-1116", "dpoa", "Corrective Action Form", "2026-11-16"),
    row("coaching-tirzah-1109", "coaching", "Coaching Form", "2026-11-09"),
    row("coaching-tirzah-1120", "coaching", "Coaching Form", "2026-11-20", "draft"),
    ...exits.map((date) => row(`exit-tirzah-${date.slice(5).replace("-", "")}`, "stc-exit", "Resignation/Exit Form", date)),
  );
}

function setUp(t: ReplayContext, exits: readonly string[]): void {
  vi.setSystemTime(new Date("2026-11-23T14:00:00Z"));
  t.directory([...STAFF, TIRZAH]);
  t.as("salon_director", KEARNEY);
  onFile(t, exits);
}

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
const findInput = (view: LoopView) => ({ employee_name: "Tirzah Quillon", open: true, forms_on_file_evidence: evidenceFrom(view, T1, users(view) - 1) });

export const NOV23_AGENT_LOOP_SHOW_FIRSTS_EXIT_CASES: ReplayCase[] = [
  {
    id: "nov23-show-firsts-exit-opens-the-one",
    title: `Verbatim: "${T1}" (one exit form on file among 6 forms): find_past_forms is not refused as someone else's forms, lists only the exit form, and it opens; never all of her forms`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, ["2026-11-20"]);
      /* The model's call as in the trace: the person and the manager's words, no `form` (the kind is read from her words). */
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: findInput(view) };
        const forms = found.forms ?? [];
        if (forms.length !== 1) return { text: forms.map((form) => `- ${form.form} ${form.form_date}`).join("\n") || (found.error ?? "") };
        if (!lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: forms[0]!.instance_id, forms_on_file_evidence: evidenceFrom(view, T1) } };
        return { text: "Opening her Resignation/Exit Form." };
      });
      t.loopModel!(model, { scripted: true });
      const reply = await t.thread().say(T1);
      const found = model.views.flatMap((view) => view.results.filter((entry) => entry.tool === "find_past_forms")).map((entry) => entry.output as Found).at(-1)!;
      expect(found.reason_code ?? null, JSON.stringify(found)).not.toBe("privacy_not_this_person");
      expect((found.forms ?? []).map((form) => form.instance_id), "not only her exit form was listed").toEqual(["exit-tirzah-1120"]);
      expect(reply.formOpened?.instanceId ?? null, `the exit form did not open:\n${reply.content}`).toBe("exit-tirzah-1120");
    },
  },
  {
    id: "nov23-show-firsts-exit-several-then-date",
    title: `"${T1}" with two exit forms on file lists only the two exit forms (never the Coaching draft of the same date); the answer "11202026" opens the 11/20 one`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, ["2026-11-20", "2026-10-02"]);
      const model = loopStandIn((view): LoopDecision => {
        if (users(view) === 1) {
          const found = lastResult(view, "find_past_forms") as Found | null;
          if (!found) return { tool: "find_past_forms", input: findInput(view) };
          return { text: `${(found.forms ?? []).map((form) => `- ${form.form} · dated ${form.form_date}`).join("\n")}\n\n${found.which_form_question ?? ""}` };
        }
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: findInput(view) };
        const exit1120 = (found.forms ?? []).find((form) => form.form_date === "2026-11-20" && /exit/i.test(form.form ?? ""));
        if (!lastResult(view, "open_form") && exit1120) return { tool: "open_form", input: { instance_id: exit1120.instance_id, forms_on_file_evidence: evidenceFrom(view, T1, 1), choice_evidence: evidenceFrom(view, "11202026") } };
        const opened = lastResult(view, "open_form") as { reason_code?: string; error?: string } | null;
        return { text: opened?.error ?? "Opening the 11/20 Resignation/Exit Form." };
      });
      t.loopModel!(model, { scripted: true });
      const thread = t.thread();
      await thread.say(T1);
      const listed = model.views.flatMap((view) => view.results.filter((entry) => entry.tool === "find_past_forms")).map((entry) => entry.output as Found)[0]!;
      expect((listed.forms ?? []).map((form) => form.instance_id).sort(), "the list held more than her exit forms").toEqual(["exit-tirzah-1002", "exit-tirzah-1120"]);
      const reply = await thread.say("11202026");
      expect(reply.formOpened?.instanceId ?? null, `"11202026" did not open the 11/20 exit form:\n${reply.content}`).toBe("exit-tirzah-1120");
    },
  },
  {
    id: "nov23-show-firsts-exit-verbatim-four-turns",
    title: `Her four turns, verbatim but for the name: "${T1}" → "yes" → "yes" → "11202026" opens the exit form; no reply lists her Coaching Form or asks "coaching or exit?"`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, ["2026-11-20"]);
      /*
       * The model as in the trace: T1 and T2 only ask to confirm; from T3 it looks up her forms with this message's words
       * ("yes": no kind in them, and no \`form\`), opens the one form listed, or lists them; T4 opens the first listed form
       * with the date she typed, then the next one if that is refused.
       */
      const model = loopStandIn((view): LoopDecision => {
        const turn = users(view);
        if (turn === 1) return { text: "Just to confirm — do you want to see Tirzah's Resignation/Exit Form on file?" };
        if (turn === 2) return { text: "Can you confirm: do you want Tirzah Quillon's Resignation/Exit Form?" };
        const opened = view.results.filter((entry) => entry.tool === "open_form").map((entry) => entry.output as { opened?: boolean; reason_code?: string; error?: string });
        if (opened.some((result) => !result.reason_code)) return { text: "Opening her Resignation/Exit Form." };
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (turn === 3) {
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Tirzah Quillon", open: true, forms_on_file_evidence: evidenceFrom(view, "yes") } };
          const forms = found.forms ?? [];
          if (forms.length === 1 && opened.length === 0) return { tool: "open_form", input: { instance_id: forms[0]!.instance_id, forms_on_file_evidence: evidenceFrom(view, "yes") } };
          return { text: `${forms.map((form) => `- ${form.form} · dated ${form.form_date}`).join("\n")}\n\nWhich one would you like to open?` };
        }
        const listed = (lastResult(view, "find_past_forms") as Found | null)?.forms ?? [];
        const sameDate = listed.filter((form) => form.form_date === "2026-11-20");
        const next = sameDate[opened.length];
        if (next) return { tool: "open_form", input: { instance_id: next.instance_id, forms_on_file_evidence: evidenceFrom(view, "11202026"), choice_evidence: evidenceFrom(view, "11202026") } };
        return { text: opened.at(-1)?.error ?? "Which one did you mean?" };
      });
      t.loopModel!(model, { scripted: true });
      const thread = t.thread();
      const replies = [];
      let openedId: string | null = null;
      for (const said of [T1, "yes", "yes", "11202026"]) {
        const reply = await thread.say(said);
        replies.push(reply.content);
        openedId ??= reply.formOpened?.instanceId ?? null;
        if (openedId) break;
      }
      expect(openedId, `her exit form never opened:\n${replies.join("\n---\n")}`).toBe("exit-tirzah-1120");
      expect(replies.join("\n"), "a reply listed her Coaching Form or asked coaching or exit").not.toMatch(/Coaching Form/);
    },
  },
  {
    id: "nov23-show-firsts-exit-confirm-then-open",
    title: `Confirm, then open: "${T1}" → the reply asks "do you want to see Tirzah's Resignation/Exit Form on file?" (first name only) → "yes" is not refused as someone else's forms and the exit form opens`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, ["2026-11-20"]);
      const model = loopStandIn((view): LoopDecision => {
        if (users(view) === 1) return { text: "Just to confirm — do you want to see Tirzah's Resignation/Exit Form on file?" };
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Tirzah Quillon", open: true, forms_on_file_evidence: evidenceFrom(view, "yes") } };
        const forms = found.forms ?? [];
        if (forms.length === 1 && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: forms[0]!.instance_id, forms_on_file_evidence: evidenceFrom(view, "yes") } };
        const opened = lastResult(view, "open_form") as { error?: string } | null;
        return { text: opened?.error ?? found.error ?? "Opening her Resignation/Exit Form." };
      });
      t.loopModel!(model, { scripted: true });
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say("yes");
      const refusals = model.views.flatMap((view) => view.results).map((entry) => (entry.output as { reason_code?: string }).reason_code).filter(Boolean);
      expect(refusals, "her \"yes\" was refused").not.toContain("privacy_not_this_person");
      expect(reply.formOpened?.instanceId ?? null, `the exit form did not open after "yes":\n${reply.content}`).toBe("exit-tirzah-1120");
    },
  },
  {
    id: "nov23-show-firsts-exit-type-and-date-pick-the-exit",
    title: "Type and date together: all of Tirzah's forms listed, then \"the exit 11202026\" opens the 11/20 exit form, never the Coaching draft of that date",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t, ["2026-11-20"]);
      const T1_ALL = "show me tirzahs forms";
      const T2 = "the exit 11202026";
      /* The model tries the Coaching draft of that date first, as the live model's "coaching or exit?" weighed it. */
      const model = loopStandIn((view): LoopDecision => {
        if (users(view) === 1) {
          const found = lastResult(view, "find_past_forms") as Found | null;
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Tirzah Quillon", open: true, forms_on_file_evidence: evidenceFrom(view, T1_ALL) } };
          return { text: `${(found.forms ?? []).map((form) => `- ${form.form} · dated ${form.form_date}`).join("\n")}\n\n${found.which_form_question ?? ""}` };
        }
        const tries = view.results.filter((entry) => entry.tool === "open_form").map((entry) => entry.output as { reason_code?: string; error?: string });
        if (tries.some((result) => !result.reason_code)) return { text: "Opening the 11/20 Resignation/Exit Form." };
        const order = ["coaching-tirzah-1120", "exit-tirzah-1120"];
        const next = order[tries.length];
        if (next) return { tool: "open_form", input: { instance_id: next, forms_on_file_evidence: evidenceFrom(view, T1_ALL, 1), choice_evidence: evidenceFrom(view, T2) } };
        return { text: tries.at(-1)?.error ?? "Which one?" };
      });
      t.loopModel!(model, { scripted: true });
      const thread = t.thread();
      await thread.say(T1_ALL);
      const listed = model.views.flatMap((view) => view.results.filter((entry) => entry.tool === "find_past_forms")).map((entry) => entry.output as Found)[0]!;
      expect((listed.forms ?? []).length, "no kind named: all her forms are listed").toBe(6);
      const reply = await thread.say(T2);
      const coachingTry = model.views.flatMap((view) => view.results.filter((entry) => entry.tool === "open_form")).map((entry) => entry.output as { reason_code?: string })[0];
      expect(coachingTry?.reason_code, "the Coaching draft was opened for \"the exit 11202026\"").toBe("which_form_not_chosen");
      expect(reply.formOpened?.instanceId ?? null, `"${T2}" did not open the 11/20 exit form:\n${reply.content}`).toBe("exit-tirzah-1120");
    },
  },
];
