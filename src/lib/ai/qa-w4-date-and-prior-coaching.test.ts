import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 22 OCT 2026 — WHAT EACH DATE MEANS, AND PRIOR COACHING HOWEVER IT IS SAID
 * ============================================================================
 *
 * F-03: the form's Date is chosen by meaning. Several incident dates are a
 * question ("Which date goes on the form?"), never the first one typed; a
 * coaching or talk already held is history and never the form's Date; on a
 * Coaching Form the coaching the manager held IS its Date; "dated 10/20" is
 * the form's Date.
 *
 * F-07 / F-08: an earlier coaching or talk is recognised however it is said —
 * in the Corrective Action intake and in the cards offered under an answer —
 * and a repeat that is not her conduct, or a coaching that worked, never puts
 * the Corrective Action Form on the card.
 *
 * Driven through the real proposal flow, with the open form's template sent
 * back as the browser sends it. Every person is synthetic.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};
const state = vi.hoisted(() => ({ directory: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn, suggestFormsForTurn } = await import("@/lib/ai/form-proposal");
const { readCorrectiveActionIntake } = await import("@/lib/forms/corrective-action-intake");
const { detectFormOpportunity } = await import("@/lib/forms/form-opportunity");

const TODAY = "2026-10-21";
const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] } as AccessScope };
const PAT = { id: "e-1", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] };

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.directory = [PAT];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`));
  await ensureTemplateLibrary("system");
});

let sequence = 0;

/** The manager's turns through the real proposal flow, as the browser sends them. */
async function conversation(turns: string[]) {
  const history: ChatMessage[] = [];
  const responses: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>>[] = [];
  let open: string | undefined;
  for (const text of turns) {
    sequence += 1;
    const response = await proposeFormForTurn({
      history,
      question: text,
      questionMessageId: `u${sequence}`,
      actor: ACTOR,
      summaries: await listTemplateSummaries(),
      today: TODAY,
      policyManual: async () => null,
      ...(open ? { continueTemplateKey: open } : {}),
    } as never);
    expect(response, `turn left the form intake: ${JSON.stringify(text)}`).not.toBeNull();
    responses.push(response!);
    if (response!.formProposal) open = response!.formProposal.templateKey;
    history.push(
      { id: `u${sequence}`, role: "user", content: text, createdAt: `${TODAY}T18:00:00Z` } as ChatMessage,
      {
        id: `a${sequence}`,
        role: "assistant",
        content: response!.content,
        createdAt: `${TODAY}T18:00:01Z`,
        ...(response!.formProposal ? { formProposal: response!.formProposal } : {}),
      } as ChatMessage,
    );
  }
  return { responses, last: responses[responses.length - 1]! };
}

const DATE_QUESTION = /Which date goes on the form\?/;

/* ------------------------------------------------------------------ F-03 */

describe("F-03a: several incident dates are a question, never the first one typed", () => {
  const REQUEST = "create verbal ca for pat rivera. she was late on 10/5 and 10/15. no payroll deduct";

  it("asks which date, dates the form the day it is created until answered, and keeps the payroll answer", async () => {
    const { last } = await conversation([REQUEST]);
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.formDate ?? null).toBeNull();
    expect(last.content).toMatch(DATE_QUESTION);
    expect(last.content).toMatch(/10\/5/);
    expect(last.content).toMatch(/10\/15/);
    expect(last.formProposal?.payrollDeduct).toBe("no");
  });

  it.each([
    ["most recent", "2026-10-15"],
    ["the first one", "2026-10-05"],
    ["10/15", "2026-10-15"],
  ])("takes the answer %j on the next turn, for the same form and person", async (answer, iso) => {
    const { responses, last } = await conversation([REQUEST, answer]);
    expect(responses[0]!.formProposal?.formDate ?? null).toBeNull();
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.employeeName).toMatch(/^pat rivera$/i);
    expect(last.formProposal?.formDate).toBe(iso);
    expect(last.content).not.toMatch(DATE_QUESTION);
  });

  it("\"today\" leaves the form dated the day it is created, and is not asked again", async () => {
    const { last } = await conversation([REQUEST, "today"]);
    expect(last.formProposal?.formDate ?? null).toBeNull();
    expect(last.content).not.toMatch(DATE_QUESTION);
  });

  it("an answer that chooses nothing is not taken as a date, and the question is not repeated", async () => {
    const { last } = await conversation([REQUEST, "she has been late a lot lately"]);
    expect(last.formProposal?.formDate ?? null).toBeNull();
    expect(last.content).not.toMatch(DATE_QUESTION);
  });

  it("one incident date still dates the form, with no question", async () => {
    const { last } = await conversation(["create verbal ca for pat rivera. she was late on 10/15. no payroll deduct"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
    expect(last.content).not.toMatch(DATE_QUESTION);
  });
});

describe("F-03b: a coaching or talk already held is never the Corrective Action's date", () => {
  it.each([
    "I coached her on 10/1 for being late",
    "we had a talk with her about tardiness on 10/1",
    "we discussed attendance with her on 10/1",
    "this is after her coaching on 10/1",
    "I talked to pat about tardiness on 10/1",
  ])("%s", async (phrase) => {
    const { last } = await conversation([`create a verbal ca for pat rivera, she was late again today. ${phrase}`]);
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.formDate ?? null).not.toBe("2026-10-01");
  });

  it("a date that is what she did stays the incident: \"late on 10/15 after I talked to her\"", async () => {
    const { last } = await conversation(["create a verbal ca for pat rivera, she was late on 10/15 after I talked to her"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
  });

  it("\"talked to pat about being late on 10/1\" — the 10/1 is the lateness, so with 10/15 there are two incidents to ask about", async () => {
    const { last } = await conversation(["create a verbal ca for pat rivera. I talked to pat about being late on 10/1 and she was late again on 10/15"]);
    expect(last.formProposal?.formDate ?? null).toBeNull();
    expect(last.content).toMatch(DATE_QUESTION);
  });

  it("an earlier warning \"dated\" a day is history, not the form's date", async () => {
    const { last } = await conversation(["create a verbal ca for pat rivera. she got a written warning dated 9/21 and was late again on 10/15"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
  });
});

describe("F-03c: on a Coaching Form, the coaching the manager held is the form's date", () => {
  it("\"…late on 10/5 and 10/15, I coached her on 10/16\" is dated 10/16, with no question", async () => {
    const { last } = await conversation(["coaching form for pat rivera, she was late on 10/5 and 10/15, I coached her on 10/16"]);
    expect(last.formProposal?.templateKey).toBe("coaching");
    expect(last.formProposal?.formDate).toBe("2026-10-16");
    expect(last.content).not.toMatch(DATE_QUESTION);
  });

  it("a coaching held BEFORE what she did is history: \"I coached her on 9/1 and she was late again on 10/15\"", async () => {
    const { last } = await conversation(["coaching form for pat rivera. I coached her on 9/1 and she was late again on 10/15"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
  });

  it("a labelled earlier coaching is never the Coaching Form's date", async () => {
    const { last } = await conversation(["coaching form for pat rivera, previous coaching 9/1, she was late again on 10/15"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
  });

  it("two coachings after the incident are a question, among them", async () => {
    const { last } = await conversation(["coaching form for pat rivera, she was late on 10/5, I coached her on 10/6 and again on 10/16"]);
    expect(last.formProposal?.formDate ?? null).toBeNull();
    expect(last.content).toMatch(DATE_QUESTION);
    expect(last.content).toMatch(/10\/6/);
    expect(last.content).toMatch(/10\/16/);
  });

  it("on a Corrective Action the same coaching stays history", async () => {
    const { last } = await conversation(["create a verbal ca for pat rivera, she was late on 10/15, I coached her on 10/16"]);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
  });
});

describe("F-03d: a date given to the form is its date, and is not offered as an incident", () => {
  it.each([
    "create verbal ca for pat rivera dated 10/20. she was late on 10/5 and 10/15",
    "create verbal ca for pat rivera, she was late on 10/5 and 10/15, date the form 10/20",
    "create verbal ca for pat rivera, she was late on 10/5 and 10/15. form date: 10/20",
  ])("%s", async (request) => {
    const { last } = await conversation([request]);
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.formDate).toBe("2026-10-20");
    expect(last.content).not.toMatch(DATE_QUESTION);
  });
});

/* ------------------------------------------------------------ F-07 / F-08 */

const PRIOR = [
  "I coached her on 10/1 for being late",
  "she was coached last week about lateness",
  "we had a talk with her about tardiness on 10/1",
  "I already spoke to her about being late",
  "she had a coaching on 10/1",
  "previous coaching 10/1 for lateness",
  "this is after her coaching on 10/1",
  "she's been coached before for this",
  "we discussed attendance with her on 10/1",
  "she got a verbal warning on 10/1",
  "I talked to pat about being late last month",
  "she was written up for this in september",
];

describe("F-07: an earlier coaching is recognised in the Corrective Action intake, however it is said", () => {
  it.each(PRIOR)("%s", (phrase) => {
    const reading = readCorrectiveActionIntake({
      text: `create a verbal ca for pat rivera, she was late again today. ${phrase}`,
      employeeKnown: true,
      salonSettled: true,
    } as never);
    expect(reading.supplied).toContain("previous_action");
  });

  it.each(PRIOR)("and the card does not leave it to the manager: %s", async (phrase) => {
    const { last } = await conversation([`create a verbal ca for pat rivera, she was late again today. ${phrase}`]);
    expect(last.content).not.toMatch(/any prior coaching or corrective action/i);
  });

  it.each([
    "she was late again today",
    "give her a written warning",
    "I talked to her today about being late",
    "she was late on 10/15 and I need to talk to her",
  ])("a repeat, an instruction, or today's conversation is not a history: %s", (text) => {
    const reading = readCorrectiveActionIntake({ text: `create a ca for pat rivera, ${text}`, employeeKnown: true, salonSettled: true } as never);
    expect(reading.supplied).not.toContain("previous_action");
  });
});

describe("F-07: the next rung is offered beside Coaching when a coaching did not work", () => {
  const offered = async (text: string) => {
    const found = suggestFormsForTurn({
      history: [],
      question: text,
      questionMessageId: "q1",
      actor: ACTOR,
      summaries: await listTemplateSummaries(),
      today: TODAY,
    } as never);
    return found ? [found.selection.primary.templateKey, ...found.selection.additional.map((card) => card.templateKey)] : [];
  };

  it.each(PRIOR)("Pat Rivera was late again today. %s", async (phrase) => {
    const keys = await offered(`Pat Rivera was late again today. ${phrase}. what should I do?`);
    expect(keys[0]).toBe("coaching");
    expect(keys).toContain("dpoa");
  });

  it("\"I talked to Pat Rivera about being late and she was late again this week\"", async () => {
    expect(await offered("I talked to Pat Rivera about being late and she was late again this week")).toContain("dpoa");
  });
});

describe("F-08: no next rung for a repeat that is not her conduct, or a coaching that worked", () => {
  it.each([
    "I already talked to her about the schedule and she still wants more hours",
    "I already addressed the broken bed with the vendor again",
    "I coached her and she improved",
    "I coached Pat Rivera about dress code and she improved, but she is still a little late sometimes",
    "Pat Rivera keeps asking for saturdays off even though I talked to her about it",
  ])("%s", async (text) => {
    expect(detectFormOpportunity({ context: { text }, employeeKnown: true })?.kind ?? null).not.toBe("formal");
  });

  it("a first offence offers Coaching, not the Corrective Action Form", async () => {
    const found = suggestFormsForTurn({
      history: [],
      question: "Pat Rivera was late today for the first time. what should I do?",
      questionMessageId: "q1",
      actor: ACTOR,
      summaries: await listTemplateSummaries(),
      today: TODAY,
    } as never);
    const keys = found ? [found.selection.primary.templateKey, ...found.selection.additional.map((card) => card.templateKey)] : [];
    expect(keys).not.toContain("dpoa");
  });
});
