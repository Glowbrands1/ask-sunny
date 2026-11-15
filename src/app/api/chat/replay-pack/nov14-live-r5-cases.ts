import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EMPLOYEE'S SALON, AND NO WORD-FOR-WORD REPEAT (QA's tester run on Pau's account, 14 Nov 2026)
 * ============================================================================
 *
 * L3/L4: a manager on two salons; the card stayed needs_location and the loop asked "which salon" on every turn (L4:
 * five turns, then took the first name "oriel" as no answer). Woven already lists the employee's salon. L5: "Yes" to "Using
 * <X> from your staff list" was answered with the first reply's "What happened?" word for word.
 *
 * The fix is a fact (propose_form's employee_salon, from the roster row's primary salon in the manager's scope) and
 * rules-book lines (file it there and say so in one line; ask once at most; never repeat a question word for word).
 * The careful stand-ins follow the rules, so these hold offline; live, the real model takes their place and only the
 * outcome is checked. Every person here is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's tester run on Pau's account (14 Nov 2026), L3/L4 and L5";

/** Works at both of the manager's salons; Woven lists Kearney (loc-0309) as her salon. */
const ORIEL: DirectoryRow & { primarySalonId: string } = { id: "e-oriel-fenwick", firstName: "Oriel", lastName: "Fenwick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant", primarySalonId: "loc-0309" };

/** Works at both of the manager's salons, with no primary salon in Woven: her card waits for the salon (E4's <A>). */
const LISSA: DirectoryRow = { id: "e-lissa-tormane", firstName: "Lissa", lastName: "Tormane", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };

/** A manual section, as the close-spelling cases build them (`nov13-close-spelling-cases.ts`). */
function manualChunk(index: number, page: number, heading: string, body: string) {
  return { chunkIndex: index, chunkId: `loop-${index}`, locator: `Page ${page} — ${heading}`, page: page + 1, content: `${heading}\n${body}`, section: heading, printedPage: page, sections: [{ page, heading }] };
}

const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));
/** Offline only: a live run checks outcomes, never which tool facts the real model asked for. */
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const REPORT_E = "QA's tester run on Pau's account (14 Nov 2026), part 4 follow-ups";

const lastResultIn = (views: readonly LoopView[], tool: string) => views.map((view) => lastResult(view, tool)).filter(Boolean).at(-1) ?? null;
const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const allSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n");
const facts = (view: LoopView) => (lastResult(view, "propose_form")?.facts ?? {}) as { employee_salon?: string };

/** A careful model: proposes, files the card at the employee's salon when Woven lists one, and says so in one line. */
function carefulSalon(): ReturnType<typeof loopStandIn> {
  return loopStandIn((view): LoopDecision => {
    const said = allSaid(view);
    const tries = view.results.filter((result) => result.tool === "propose_form").length;
    const input = {
      template_key: "dpoa",
      employee_id: ORIEL.id,
      what_happened: /20 minutes/.test(said) ? "Oriel Fenwick was 20 minutes late on 11/12." : "Oriel Fenwick was late on 11/12.",
      ...(/written/.test(said) ? { warning_level: "written" } : {}),
      ...(/no payroll/.test(said) ? { payroll_deduct: "no" } : {}),
    };
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwick" } };
    if (tries === 0) return { tool: "propose_form", input: { ...input, salon: "kearney" } };
    if (tries === 1 && facts(view).employee_salon) return { tool: "propose_form", input: { ...input, salon: facts(view).employee_salon } };
    return { text: `Got it, Oriel.\n\nHere's the Corrective Action Form for **Oriel Fenwick**, filed at **NE Kearney**, where Woven lists Oriel; say if it's another salon.\n\n**Observation of Offense:** ${input.what_happened}` };
  });
}

export const NOV14_LIVE_R5_CASES: ReplayCase[] = [
  {
    id: "nov14-live-r5-salon-from-woven-not-asked",
    title: "QA L3/L4: a manager on two salons, an employee Woven lists at the second; the request names no salon: the card is filed there and the reply never asks which salon",
    report: `${REPORT}: "the card stays needs_location and the loop asks which salon on every turn"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      // The first proposal names no salon: the stand-in only adds one from the fact.
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const tries = view.results.filter((result) => result.tool === "propose_form").length;
        const input = { template_key: "dpoa", employee_id: ORIEL.id, what_happened: "Oriel Fenwick was late on 11/12." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwick" } };
        if (tries === 0) return { tool: "propose_form", input };
        if (tries === 1 && facts(view).employee_salon) return { tool: "propose_form", input: { ...input, salon: facts(view).employee_salon } };
        return { text: "Here's the Corrective Action Form for **Oriel Fenwick**, filed at **NE Kearney**, where Woven lists Oriel; say if it's another salon.\n\n**Observation of Offense:** Late on 11/12." };
      }));
      const thread = t.thread();
      const reply = await thread.say("ca for oriel fenwick, she was late on 11/12");
      expect(thread.proposal?.locationId, `the card is not at Woven's salon:\n${reply.content}`).toBe("loc-0309");
      expect(thread.proposal?.status).toBe("ready");
      expect(reply.content, "asked which salon although Woven lists it").not.toMatch(/which salon/i);
    },
  },
  {
    id: "nov14-live-r5-l4-salon-asked-at-most-once",
    title: "QA L4's shape (five turns: the request, the account, the level, payroll, a first name): the salon is asked at most once, a first name is never taken as the salon answer, and the card ends at Woven's salon",
    report: `${REPORT}: L4 asked for the salon five turns in a row; t5 "oriel" got "I need the salon, not the name"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(carefulSalon());
      const thread = t.thread();
      const replies: string[] = [];
      for (const turn of ["ca for oriel fenwick", "she was 20 minutes late on 11/12", "make it a written", "no payroll deduct", "oriel"]) {
        replies.push((await thread.say(turn)).content);
      }
      const asks = replies.filter((reply) => /which salon/i.test(reply)).length;
      expect(asks, `the salon was asked ${asks} times:\n${replies.join("\n---\n")}`).toBeLessThanOrEqual(1);
      expect(replies.at(-1) ?? "", "a first name was taken as no salon answer").not.toMatch(/need the salon|not the name/i);
      expect(thread.proposal?.locationId, "the card is not at a salon").toBe("loc-0309");
    },
  },
  {
    id: "nov14-live-r5-yes-never-repeats-the-question",
    title: "QA L5: \"Yes\" to \"Using <X> from your staff list\": the reply acknowledges it and never repeats the previous question word for word",
    report: `${REPORT}: L5, "Yes" got the first reply's "What happened?" again, word for word`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "oriel fenwik" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: ORIEL.id, salon: "kearney" } };
        return { text: /^\s*yes\b/i.test(latest(view)) ? "Got it, Oriel. What did she do? I'll put it on the form in your words." : "Using **Oriel Fenwick** from your staff list.\n\nWhat happened?" };
      }));
      const thread = t.thread();
      const first = await thread.say("ca for oriel fenwik");
      const yes = await thread.say("Yes");
      const lastQuestion = (text: string) => text.split(/\n+/).filter((line) => /\?\s*$/.test(line)).at(-1)?.trim() ?? "";
      expect(lastQuestion(yes.content), `the question was repeated word for word:\n${yes.content}`).not.toBe(lastQuestion(first.content) || "\u0000");
    },
  },
  {
    id: "nov14-live-r5-e3-just-make-it-after-a-policy",
    title: "QA E3: \"cite the animals in the workplace policy\" then \"just make it\": a Corrective Action citing that policy, and ONE question, who it is for (never the form type again)",
    report: `${REPORT_E}: E3, "just make it" right after a policy answer re-asked the form type and the person`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: "Animals in the Workplace" } };
        const policy = lastResult(view, "read_policy") as { heading?: string; page?: number };
        return {
          text: /just make it/i.test(latest(view))
            ? `Corrective Action citing **${policy.heading}** (p.${policy.page}). Who is it for?`
            : `**${policy.heading}** (p.${policy.page}) covers animals brought to work.`,
        };
      }));
      const thread = t.thread();
      await thread.say("cite the animals in the workplace policy");
      const reply = await thread.say("just make it");
      expect(reply.content, `the policy was not carried forward:\n${reply.content}`).toMatch(/Animals in the Workplace/);
      expect(reply.content, "the person was not asked").toMatch(/who (?:is|'s) (?:it|this|the form) for/i);
      expect(reply.content, "the form type was asked again").not.toMatch(/which form|coaching (?:form )?or (?:a )?corrective|corrective action or (?:a )?coaching/i);
      expect((reply.content.match(/\?/g) ?? []).length, `more than one question:\n${reply.content}`).toBe(1);
    },
  },
  {
    id: "nov14-live-r5-e4-same-thing-for-b-never-waits",
    title: "QA E4: \"same thing for <B>\" while <A>'s card waits for a salon: <B>'s own card is made now (same form and account, <B>'s salon from Woven), never held behind <A>",
    report: `${REPORT_E}: E4, "I'll prepare her coaching form once Employee H's salon is settled" and no card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, LISSA, ORIEL]);
      t.as("salon_director", TWO_SALONS);
      const account = (name: string) => `${name} skipped the spray booth check on 11/12.`;
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const forB = /same thing for oriel/i.test(latest(view));
        const tries = view.results.filter((result) => result.tool === "propose_form").length;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: forB ? "oriel fenwick" : "lissa tormane" } };
        const input = forB
          ? { template_key: "coaching", employee_id: ORIEL.id, what_happened: account("Oriel Fenwick") }
          : { template_key: "coaching", employee_id: LISSA.id, what_happened: account("Lissa Tormane") };
        if (tries === 0) return { tool: "propose_form", input };
        if (forB && tries === 1 && facts(view).employee_salon) return { tool: "propose_form", input: { ...input, salon: facts(view).employee_salon } };
        return {
          text: forB
            ? "Here's the Coaching Form for **Oriel Fenwick**, filed at **NE Kearney**, where Woven lists Oriel; say if it's another salon.\n\nLissa Tormane's card still needs its salon: which one, NE Grand Island or NE Kearney?"
            : "Here's the Coaching Form for **Lissa Tormane**. Which salon: NE Grand Island or NE Kearney?",
        };
      }));
      const thread = t.thread();
      await thread.say("coaching form for lissa tormane, she skipped the spray booth check on 11/12");
      const reply = await thread.say("same thing for oriel fenwick");
      expect(thread.proposal?.employeeName, `no card for <B>:\n${reply.content}`).toBe("Oriel Fenwick");
      expect(thread.proposal?.templateKey).toBe("coaching");
      expect(thread.proposal?.issue ?? "", "<B>'s card does not carry the account").toMatch(/spray booth/i);
      expect(thread.proposal?.locationId, "<B>'s card is not at Woven's salon").toBe("loc-0309");
      expect(reply.content, "<B> was held behind <A>").not.toMatch(/once .{0,40}(?:salon|store) is (?:settled|set|chosen)|after .{0,30}'s (?:salon|card)/i);
    },
  },
  {
    id: "nov14-live-r5-e5-ca-for-a-misspelled-policy-no-person",
    title: "QA E5: \"ca for the key holdr policy\" (no person): the question names the matched policy, and \"use that one\" means that policy, never a person",
    report: `${REPORT_E}: E5, "use that one" got "I'm not sure who 'that one' refers to"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([manualChunk(900, 60, "Key Holder Guidelines", "A key holder opens and closes the location.")]);
      const model = loopStandIn((view): LoopDecision => {
        const read = view.results.filter((result) => result.tool === "read_policy").map((result) => result.output as { heading?: string; page?: number; close_heading?: string });
        if (/use that one/i.test(latest(view))) return { text: "Got it: **Key Holder Guidelines** (p.60) for the Corrective Action. Who is it for?" };
        if (read.length === 0) return { tool: "read_policy", input: { heading: "key holdr" } };
        if (!read.at(-1)?.heading && read.at(-1)?.close_heading) return { tool: "read_policy", input: { heading: read.at(-1)!.close_heading } };
        return { text: `Corrective Action citing **${read.at(-1)?.heading}** (p.${read.at(-1)?.page}). Who is it for?` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const first = await thread.say("ca for the key holdr policy");
      expect(first.content, `the matched policy is not named:\n${first.content}`).toMatch(/Key Holder Guidelines/);
      expect(first.content).toMatch(/who (?:is|'s) (?:it|this|the form) for/i);
      if (offline) expect(toolResults(model.views, "read_policy").some((result) => /"close_heading":"Key Holder Guidelines"/.test(result)), "the close spelling is not a fact").toBe(true);
      const second = await thread.say("use that one");
      expect(second.content, `"that one" was read as a person:\n${second.content}`).not.toMatch(/not sure who|who .that one. (?:is|refers)/i);
    },
  },
  {
    id: "nov14-live-r5-e6-policy-line-in-full",
    title: "QA E6: the reply's **Policy:** line is the card's whole policy line (\"Attendance, JBA Policy Manual p.14\"), never the heading alone; the self-review hands a shortened line back",
    report: `${REPORT_E}: E6, the card said "Attendance Policy, JBA Policy Manual p.14" and the reply said just "Attendance"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const checked = /\[app check\]/.test(latest(view));
        if (!checked && !lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!checked && !lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: "Attendance" } };
        if (!checked && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/12.", warning_level: "verbal" } };
        // A model that shortens the line, then writes it as the card has it when the app hands its reply back.
        const line = checked ? /"policy":"([^"]+)"/.exec(latest(view))?.[1] ?? "Attendance" : "Attendance";
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12.\n**Type of Warning:** Verbal Warning, as you said.\n\n**Policy:** ${line}` };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("verbal ca for remy calder, 20 minutes late on 11/12, attendance policy");
      const card = reply.formProposal;
      const policyLine = (card as { policyLine?: string | null } | undefined)?.policyLine ?? "";
      expect(policyLine, "the card cites no policy").toMatch(/^Attendance.*p\.\s?14/);
      const said = /^\s*\*\*Policy:?\*\*:?\s*(.+)$/im.exec(reply.content)?.[1]?.trim() ?? "";
      expect(said.toLowerCase().replace(/[^a-z0-9]+/g, ""), `the reply's Policy line is not the card's:\n${reply.content}`).toBe(policyLine.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      if (offline) expect(model.views.some((view) => /\[app check\]/.test(latest(view))), "a shortened Policy line was not handed back").toBe(true);
    },
  },
  {
    id: "nov14-live-r5-e7-how-many-people-count-first",
    title: "QA E7: \"how many people do I have\": the reply gives the count first (\"<salon> has <n> people:\"), then the list",
    report: `${REPORT_E}: E7, "how many people do I have" listed the staff with no count`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const listed = lastResult(view, "list_staff") as { salon?: string; staff_count?: number; staff?: { name: string; position: string }[] } | null;
        if (!listed) return { tool: "list_staff", input: {} };
        return { text: `**${listed.salon}** has ${listed.staff_count} people:\n\n${(listed.staff ?? []).map((row) => `- ${row.name} (${row.position})`).join("\n")}` };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("how many people do I have");
      const count = (lastResultIn(model.views, "list_staff") as { staff_count?: number } | null)?.staff_count;
      expect(count, "list_staff gave no staff_count").toBeGreaterThan(0);
      const firstLine = reply.content.split("\n").find((line) => line.trim()) ?? "";
      expect(firstLine, `the count is not first:\n${reply.content}`).toMatch(new RegExp(`\\b${count}\\s+(?:people|employees|staff)`));
    },
  },
  {
    id: "nov14-live-r5-e7-one-position-after-the-salon",
    title: "QA E7: \"who are my tanning consultants\" on two salons: the salon is asked, then only that position's people are listed",
    report: `${REPORT_E}: E7, "who are my tanning consultants" listed the whole staff`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const listed = lastResult(view, "list_staff") as { which_salon?: boolean; salon?: string; position?: string; staff?: { name: string }[] } | null;
        const salonNamed = /kearney/i.test(latest(view));
        if (!listed) return { tool: "list_staff", input: salonNamed ? { salon: "kearney", position: "tanning consultants" } : { position: "tanning consultants" } };
        if (listed.which_salon) return { text: "Which salon's staff should I list? NE Grand Island or NE Kearney?" };
        return { text: `The Tanning Consultants at **${listed.salon}**:\n\n${(listed.staff ?? []).map((row) => `- ${row.name}`).join("\n")}` };
      }));
      const thread = t.thread();
      const ask = await thread.say("who are my tanning consultants");
      expect(ask.content, "the salon was not asked").toMatch(/which salon/i);
      const reply = await thread.say("kearney");
      expect(reply.content, `the tanning consultants are not listed:\n${reply.content}`).toMatch(/Marnie Holloway/);
      expect(reply.content, `another position was listed:\n${reply.content}`).not.toMatch(/Juno Paxton/);
    },
  },
  {
    id: "nov14-live-r5-e8-new-card-reply-says-what-is-on-it",
    title: "QA E8/E9: \"ca for <name> for violating the key holdr policy, she left the back door unlocked last night\" (no Key Holder heading in the manual): the reply says what is on the new card, says in one line which section it cites instead, and ends with the whole Policy line; a reply that is only \"The card above is still open\" is handed back",
    report: `${REPORT_E}: E8, the WHOLE reply after a new card was "The card above is still open; press Create when it looks right, or tell me what to change."`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([manualChunk(902, 25, "Security Policy", "Lock every door and the safe at close.")]);
      const model = loopStandIn((view): LoopDecision => {
        const checked = /\[app check\]/.test(latest(view));
        if (checked) {
          const line = /"\*\*Policy:\*\* ([^"]+)"/.exec(latest(view))?.[1] ?? "";
          return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\nThe JBA manual has no key holdr policy, so the card cites **Security Policy** (p.25); say if you want another.\n\n**Observation of Offense:** Remy Calder left the back door unlocked last night.\n\n**Policy:** ${line}` };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: "Security Policy" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Security Policy", what_happened: "Remy Calder left the back door unlocked last night." } };
        return { text: "The card above is still open; press Create when it looks right, or tell me what to change." };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("ca for remy calder for violating the key holdr policy, she left the back door unlocked last night");
      const policyLine = (reply.formProposal as { policyLine?: string | null } | undefined)?.policyLine ?? "";
      expect(policyLine, "the card cites no section").toMatch(/^Security Policy/);
      expect(reply.content, `the reply does not say what is on the card:\n${reply.content}`).toMatch(/Remy Calder/);
      expect(reply.content.trim(), "the whole reply is the still-open line").not.toMatch(/^The card above is still open[^\n]*$/);
      const said = /^\s*\*\*Policy:?\*\*:?\s*(.+)$/im.exec(reply.content)?.[1]?.trim() ?? "";
      expect(said.toLowerCase().replace(/[^a-z0-9]+/g, ""), `no whole Policy line:\n${reply.content}`).toBe(policyLine.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      expect(reply.content, "the reply does not say the manual has no such policy").toMatch(/no key ?ho?ldr? policy/i);
      if (offline) {
        expect(model.views.some((view) => /\[app check\] Your reply does not say what is on the card/.test(latest(view))), "the still-open-only reply was not handed back").toBe(true);
        expect(toolResults(model.views, "propose_form").some((result) => /"policy_not_in_manual":"key holdr/.test(result)), "a policy the manual lacks is not a fact").toBe(true);
      }
    },
  },
  {
    id: "nov14-live-r5-e9-one-word-answer-is-the-cards-policy",
    title: "QA E9: right after a card, a one-word answer (\"guidelines\") is about that card's policy: no knowledge search, and the reply is about the card's policy",
    report: `${REPORT_E}: E9, t2 "guidelines" searched the DM Training Manual and left the card unchanged`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([manualChunk(902, 25, "Security Policy", "Lock every door and the safe at close.")]);
      const card = (view: LoopView) => (lastResult(view, "propose_form")?.card ?? {}) as { policy?: string | null };
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: "Security Policy" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Security Policy", what_happened: "Remy Calder left the back door unlocked last night." } };
        const intro = /^guidelines$/i.test(latest(view).trim())
          ? "The JBA manual has no Key Holder Guidelines either, so the card keeps **Security Policy** (p.25); say if you want another."
          : "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder left the back door unlocked last night.";
        return { text: `${intro}\n\n**Policy:** ${card(view).policy ?? ""}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for remy calder for violating the key holdr policy, she left the back door unlocked last night");
      const before = model.views.length;
      const reply = await thread.say("guidelines");
      expect(model.views.slice(before).some((view) => view.results.some((result) => result.tool === "search_knowledge")), "a one-word answer about the card's policy became a knowledge search").toBe(false);
      expect(reply.content, `the reply is not about the card's policy:\n${reply.content}`).toMatch(/Security Policy/);
    },
  },
  {
    id: "nov14-live-r5-e10-month-day-later-than-today-said",
    title: "QA E10: \"write up <name> for being late on 12/20\" sent on 11/14: the card is dated last year's 12/20, and the reply says so in one line",
    report: `${REPORT_E}: E10, the card was silently dated 2025-12-20, with no line saying so`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { policy?: string | null }; facts?: { date_read_as_last_year?: { said: string; date: string } } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 12/20.", incident_date: "2025-12-20" } };
        const read = result.facts?.date_read_as_last_year;
        return {
          text: [
            "Here's the Corrective Action Form for **Remy Calder**.",
            read ? "Dated 12/20/2025 (last December); say if you meant another day." : "",
            "**Observation of Offense:** Remy Calder was late on 12/20.",
            result.card?.policy ? `**Policy:** ${result.card.policy}` : "",
          ].filter(Boolean).join("\n\n"),
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up remy calder for being late on 12/20");
      const formDate = thread.proposal?.formDate ?? "";
      expect(formDate <= "2026-11-14", `the card is dated after today: ${formDate}`).toBe(true);
      if (formDate === "2025-12-20") expect(reply.content, `the past-year reading is not said:\n${reply.content}`).toMatch(/12\/20\/2025|December 20, 2025|last December/i);
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /"date_read_as_last_year":\{"said":"12\/20","date":"2025-12-20"\}/.test(result)), "the past-year reading is not a fact").toBe(true);
    },
  },
  /*
   * The E11 reword case was here. Pau (15 Nov) paused rewording, so a reword writes nothing at all (batch G, G0, below in
   * nov15-agent-loop-batch-g-cases.ts). E11's reword_added_link fact keeps its unit test (reword-links.test.ts).
   */
  {
    id: "nov14-live-r5-e12-a-date-after-today-is-never-on-the-card",
    title: "QA E12 (Pau's review): \"write up <name> for being late on 12/20/2026\" sent on 11/14: the card holds no date after today, and the reply asks which day; a draft's form_date after today is refused",
    report: `${REPORT_E}: E12, since batch C a date after today was only a fact, so the card kept the future date`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { date_after_today?: unknown } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 12/20/2026.", incident_date: "2026-12-20" } };
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n${result.facts?.date_after_today ? "12/20/2026 is after today, so the card has no date yet. Which day was it?" : "Dated 12/20/2026."}\n\n**Observation of Offense:** Remy Calder was late on 12/20/2026.` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up remy calder for being late on 12/20/2026");
      expect(thread.proposal?.formDate ?? "", `the card holds a date after today:\n${reply.content}`).not.toMatch(/^2026-12-20$/);
      expect((thread.proposal?.formDate ?? "") <= "2026-11-14").toBe(true);
      expect(reply.content, "the reply does not ask which day").toMatch(/which day|what day|which date|what date/i);
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /"date_after_today":\{"date":"2026-12-20"/.test(result)), "the future date is not a fact").toBe(true);
    },
  },
  {
    id: "nov14-live-r5-e12-edit-form-refuses-a-form-date-after-today",
    title: "QA E12 (Pau's review), refined by G11: with a draft open, a form date after today that the manager never typed is refused; \"change the date to 12/20/2026\", typed by the manager, is refused too and asks which day",
    report: `${REPORT_E}: E12, the same for edit_form writing form_date`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was late on 11/12." };
      }));
      const thread = t.thread();
      await thread.say("write up remy calder for being late on 11/12");
      const id = await thread.create();
      const before = t.values(id).form_date ?? "";
      const editor = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form");
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { form_date: "2026-12-20" } } };
        return { text: edit.error ? "That date is after today, so I didn't change it. Which day was it?" : "Done." };
      });
      t.loopModel!(editor);
      // A date the manager never typed (the model's own reading): refused, nothing written.
      const unsaid = await thread.say("fix the date on it");
      expect(t.values(id).form_date ?? "", `a form date after today nobody typed was written:\n${unsaid.content}`).toBe(before);
      if (offline) expect(toolResults(editor.views, "edit_form")[0], "edit_form wrote a date after today nobody typed").toMatch(/is after today \(2026-11-14/);
      /*
       * Changed on purpose (QA's design, 15 Nov 2026, item D, reversing the G11 allowance): on a Corrective Action, a
       * form date after today is always refused with one question, even when the manager typed it.
       */
      const asked = await thread.say("change the date to 12/20/2026");
      expect(t.values(id).form_date ?? "", `a form date after today was written:\n${asked.content}`).toBe(before);
      expect(asked.content).toMatch(/after today.*Which day/);
    },
  },
  {
    id: "nov14-live-r5-e13-central-evening-is-still-today",
    title: "QA E13 (Pau's review): on the evening of 11/14, salon time (UTC is already 11/15), \"write up <name> for being late on 11/15\": the card is never dated this year's 11/15",
    report: `${REPORT_E}: E13, monthDayToIso used the server's UTC clock, not the salon's local date`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // 11:30 pm Eastern (the app's BUSINESS_TIMEZONE default) and 10:30 pm Central on 11/14; UTC is already 11/15.
      vi.setSystemTime(new Date("2026-11-15T04:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { date_after_today?: unknown; date_read_as_last_year?: unknown } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/15.", incident_date: "2026-11-15" } };
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n${result.facts?.date_after_today ? "11/15/2026 is after today, so the card has no date yet. Which day was it?" : "Dated 11/15."}` };
      }));
      const thread = t.thread();
      const reply = await thread.say("write up remy calder for being late on 11/15");
      expect(thread.proposal?.formDate ?? "", `the card is dated tomorrow (UTC's today):\n${reply.content}`).not.toBe("2026-11-15");
    },
  },
  {
    id: "nov14-live-r5-e14-a-date-in-another-style-is-kept",
    title: "QA E14 (Pau's live chats): \"9-28-26\" in the request and \"September 28, 2026\" in the account: the date is kept, nothing is flagged missing",
    report: `${REPORT_E}: E14, Pau's chats at 01:45, 01:53 and 01:54 PHT flagged "9-28-26" as left out of an account that wrote it out`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was a no call no show on September 28, 2026.", incident_date: "2026-09-28" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was a no call no show on September 28, 2026." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("ca for remy calder, she was a no call no show on 9-28-26");
      expect(thread.proposal?.issue ?? "", `the date is not on the card:\n${reply.content}`).toMatch(/September 28, 2026|9[-/]28/);
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /account_words_missing/.test(result)), "a date written another way was flagged missing").toBe(false);
    },
  },
  {
    id: "nov14-live-r5-e15-trace-keeps-the-reason-never-the-words",
    title: "QA E15: a tool result's refusal kind and fact keys are on the trace (account_words_missing as kinds: date), never the names, words or figures",
    report: `${REPORT_E}: E15, the trace recorded ok:false with no reason, so the 9-28-26 flag could not be explained`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      if (!offline) return; // the trace's shape, not the model's choices
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const tries = view.results.filter((result) => result.tool === "propose_form").length;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (tries === 0) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was a no call no show." } };
        if (tries === 1) return { tool: "edit_form", input: { instance_id: "no-such-form", values: { form_date: "2026-12-20" } } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was a no call no show." };
      }));
      await t.thread().say("ca for remy calder, she was a no call no show on 10/3");
      const rows = t.rows?.("chat_traces") ?? [];
      const row = [...rows].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
      expect(row, "no chat trace with the loop's steps").toBeTruthy();
      const steps = (row!.slots as { agent_loop: { steps: { tool: string; ok: boolean; error_kind?: string; fact_keys?: string[]; missing_kinds?: string[] }[] } }).agent_loop.steps;
      const proposed = steps.find((step) => step.tool === "propose_form");
      expect(proposed?.fact_keys ?? [], "the propose_form step names no facts").toContain("account_words_missing");
      expect(proposed?.missing_kinds, "the missing words are not given as kinds").toEqual(["date"]);
      const edited = steps.find((step) => step.tool === "edit_form");
      expect(edited?.ok).toBe(false);
      expect(edited?.error_kind, "a refused step has no reason").toBeTruthy();
      expect(JSON.stringify(steps), "the trace carries names, words or figures").not.toMatch(/Remy|Calder|no call|10\/3|2026-12-20/i);
    },
  },
];
