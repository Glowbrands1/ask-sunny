import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING AN OPEN CORRECTIVE ACTION FORM FROM THE CONVERSATION
 * ============================================================================
 *
 * Production feedback, 20 Oct 2026. With a Corrective Action Form for Wren
 * Halvorsen open, "can you add late opening policy to the direct policy
 * section of this from" was answered "No form has been created yet", and the
 * manager was told to create the form again. A manager has to be able to add
 * or swap a policy, change a detail, and answer a question — on the form that
 * is open — without starting another one.
 *
 * End to end through the real proposal, creation and draft routes against the
 * fake database and the real JBA manual fixture; then the chat handlers the
 * route tries, in the order it tries them.
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

const state = vi.hoisted(() => ({
  role: "salon_director",
  scope: null as unknown,
  toolValues: {} as Record<string, string>,
  toolChecked: {} as Record<string, string[]>,
  systems: [] as string[],
  manualOk: true,
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "manager-1",
          email: "manager@example.com",
          displayName: "Manager",
          role: state.role,
          scope: state.scope,
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { system: string }) => {
        state.systems.push(request.system);
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: { values: state.toolValues, checked: state.toolChecked } }],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async fetchRoleGrounding() {
        const row = (index: number, locator: string, content: string) => ({
          chunk_id: `pmf-${index}`,
          document_id: "doc-progression",
          document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          category: "leadership_coaching",
          locator,
          page: null,
          section: null,
          content,
          similarity: 0,
        });
        return {
          ok: true,
          grounding: {
            role: { id: "performance_management_framework" },
            documentId: "doc-progression",
            documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
            matchedBy: "tag",
            rows: [
              row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."),
              row(1, "10.7 Final operating rule for Ask Sunny", "Classify the issue before escalating."),
            ],
            presentGroups: ["escalation_ladder", "final_operating_rule"],
          },
        };
      }
      async fetchOfficialPolicyManual() {
        if (!state.manualOk) return { ok: false, reason: "down" };
        return {
          ok: true,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          matchedBy: "tag",
          chunks: JBA_MANUAL_CHUNKS,
        };
      }
    },
  };
});

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { correctActiveForm } = await import("@/lib/forms/chat-correction");
const { changeActiveFormPolicy } = await import("@/lib/forms/chat-policy-change");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");
const { describeOpenForm } = await import("@/lib/forms/open-form-summary");
const { saveInstanceValues } = await import("@/lib/forms/instances");
const { CA_ACTION_PLAN_CLOSING: CLOSING } = await import("@/lib/forms/required-closing");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-20",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string; provenance?: Record<string, unknown> }[];
  };
}

const row = async (id: string, key: string) => (await review(id)).values.find((entry) => entry.fieldKey === key);

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-20T15:00:00Z",
});

const chat = () => new Request("https://app.test/api/chat", { method: "POST" });

/**
 * A verbal warning for Wren, created in chat. The account says she was late
 * rather than naming Late Opening, so the first draft cites Attendance and the
 * Late Opening section is what the conversation then asks to add. (Named in
 * the account, the first draft cites Late Opening by itself — see
 * `DESCRIBED_SECTIONS`.)
 */
async function createdForm() {
  const message = said("create corrective action for Wren Halvorsen, she was late to work today. It is a verbal warning");
  const response = await proposeFormForTurn({
    history: [],
    question: message.content,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-20",
  });
  const proposal = response!.formProposal!;
  expect(proposal.templateKey).toBe("dpoa");
  expect(proposal.employeeName).toBe("Wren Halvorsen");
  const result = await createInlineForm({ proposal, messages: [message], call, onCreated: () => {} });
  joinOverview();
  const id = (store.form_instances ?? [])[0]!.id as string;
  const history: ChatMessage[] = [
    message,
    { id: "a1", role: "assistant", content: response!.content, createdAt: "2026-10-20T15:00:01Z", formProposal: proposal } as ChatMessage,
  ];
  return { id, result, history };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.toolValues = { observation: "Observed: Wren did not open the salon on time.\nExpectation: Open on time.\nGoing Forward: Wren will open on time." };
  state.toolChecked = { warning_type: ["verbal"], offense_type: ["tardiness"] };
  state.systems = [];
  state.manualOk = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("a policy named in the conversation goes onto the open form", () => {
  it("adds Late Opening to Direct policy, in the manual's own words, as verified", async () => {
    const { id, history } = await createdForm();
    /* The Action Plan Ask Sunny built names what Direct policy cites (District Manager feedback, 21 Oct 2026). */
    expect((await row(id, "action_plan"))?.value).toBe(`Management will review the Attendance policy with Wren. ${CLOSING}`);

    const answer = await changeActiveFormPolicy({
      request: chat(),
      instanceId: id,
      question: "can you add late opening policy to the direct policy section of this from",
      history,
    });

    expect(answer?.content).toContain("Late Opening");
    expect(answer?.content).not.toMatch(/no form has been created/i);
    expect(answer?.formUpdate).toEqual({ instanceId: id, updated: ["policy_language", "policy_violated", "action_plan"] });
    /* Policy Violated names the section beside its box, as a first draft does (District Manager feedback, 21 Oct 2026). */
    expect((await row(id, "policy_violated"))?.value).toBe("Tardiness/Leaving Early — Late Opening");
    /* The Action Plan follows Direct policy: both sections, in the order cited. */
    expect(answer?.content).toContain("The Action Plan now says management will review the Attendance and Late Opening policies with Wren.");
    expect((await row(id, "action_plan"))?.value).toBe(
      `Management will review the Attendance and Late Opening policies with Wren. ${CLOSING}`,
    );
    const policy = await row(id, "policy_language");
    /* The fixture's wording is synthetic (no policy text in this repository); the section is what is checked. */
    expect(policy?.value).toContain("Synthetic policy wording");
    expect(policy?.value).toContain("Source: JBA Policy Manual — Late Opening, p. 15");
    expect(policy?.filledBy).toBe("ai");
  });

  it("keeps what was cited when the manager says add, and replaces it when they say instead", async () => {
    const { id, history } = await createdForm();
    const before = (await row(id, "policy_language"))?.value ?? "";
    expect(before).toContain("Attendance");

    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy too", history });
    const added = (await row(id, "policy_language"))?.value ?? "";
    expect(added).toContain("Attendance");
    expect(added).toContain("Late Opening");

    const swapped = await changeActiveFormPolicy({
      request: chat(),
      instanceId: id,
      question: "Actually use the dress code policy instead",
      history,
    });
    const value = (await row(id, "policy_language"))?.value ?? "";
    expect(value).toContain("Dress Code for The Company");
    expect(value).not.toContain("Late Opening");
    expect(swapped?.content).toMatch(/no longer cites/i);
    /*
     * A policy named INSTEAD is the box that is ticked (QA, 22 Oct 2026): the
     * draft's Tardiness moves to Dress Code, and Policy Violated follows, so
     * the form never names two policies.
     */
    expect((await row(id, "offense_type"))?.checked).toEqual(["dress_code"]);
    expect((await row(id, "policy_violated"))?.value).toBe("Dress Code Violation");
    expect(swapped?.content).toMatch(/Type of Offense now reads \*\*Dress Code Violation\*\*/);
  });

  it("removes a section the manager takes off, and blanks the line when it was the only one", async () => {
    const { id, history } = await createdForm();
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "use the late opening policy instead", history });

    const answer = await changeActiveFormPolicy({
      request: chat(),
      instanceId: id,
      question: "take the late opening policy off the form",
      history,
    });
    expect(answer?.content).toMatch(/Removed \*\*Late Opening\*\*/);
    expect((await row(id, "policy_language"))?.value ?? "").toBe("");
    /* With no section cited, Policy Violated is the box alone, and the built plan names it. */
    expect(answer?.formUpdate?.updated).toEqual(["policy_language", "policy_violated", "action_plan"]);
    expect((await row(id, "policy_violated"))?.value).toBe("Tardiness/Leaving Early");
    expect(answer?.content).toContain("The Action Plan has been updated to match.");
    expect((await row(id, "action_plan"))?.value).toBe(
      `Management will review the Tardiness/Leaving Early policy with Wren. ${CLOSING}`,
    );
  });

  it("says plainly when the manual has no such section, and changes nothing", async () => {
    const { id, history } = await createdForm();
    const before = (await row(id, "policy_language"))?.value;

    const answer = await changeActiveFormPolicy({
      request: chat(),
      instanceId: id,
      question: "add the moon landing policy",
      history,
    });
    expect(answer?.content).toMatch(/couldn't find a section called "moon landing"/);
    expect((await row(id, "policy_language"))?.value).toBe(before);
  });

  it("reads 'that policy' from the turn that quoted it", async () => {
    const { id, history } = await createdForm();
    const quoted: ChatMessage[] = [
      ...history,
      said("what does the manual say about late opening?"),
      { id: "a2", role: "assistant", content: "The manual's Late Opening section says the employee must notify the manager.", createdAt: "2026-10-20T15:01:00Z" } as ChatMessage,
    ];
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "please use that policy on the form", history: quoted });
    expect((await row(id, "policy_language"))?.value).toContain("Late Opening");
  });

  it("leaves a turn that names no policy to the ordinary answer", async () => {
    const { id, history } = await createdForm();
    for (const question of [
      "I have independently verified and the policy is correct you may issue",
      "what is the late opening policy?",
      "create a corrective action for Dana Moss for the dress code policy",
    ]) {
      expect(await changeActiveFormPolicy({ request: chat(), instanceId: id, question, history }), question).toBeNull();
    }
  });

  it("says so, and changes nothing, when the manual cannot be read", async () => {
    const { id, history } = await createdForm();
    const before = (await row(id, "policy_language"))?.value;
    state.manualOk = false;
    const answer = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy", history });
    expect(answer?.content).toMatch(/couldn't read the official policy manual/);
    expect((await row(id, "policy_language"))?.value).toBe(before);
  });
});

describe("any other change to the open Corrective Action Form is made in place", () => {
  it("changes the warning level, re-derives Policy Violated, and never lets the model write a policy line", async () => {
    const { id, history } = await createdForm();
    const before = (await row(id, "policy_language"))?.value;
    const plan = (await row(id, "action_plan"))?.value;
    state.toolValues = {
      policy_language: "Invented policy text.",
      policy_violated: "Something else",
      action_plan: "Wren must apologise to the whole team before her next shift.",
    };
    state.toolChecked = { warning_type: ["written"], offense_type: ["absenteeism"] };

    const answer = await reviseActiveForm({
      request: chat(),
      instanceId: id,
      question: "Change it to a written warning and change the offense to absenteeism",
      history,
      today: "2026-10-20",
    });

    expect(answer?.content).toMatch(/Updated the \*\*Corrective Action Form\*\*/);
    expect((await row(id, "warning_type"))?.checked).toEqual(["written"]);
    expect((await row(id, "offense_type"))?.checked).toEqual(["absenteeism"]);
    expect((await row(id, "policy_violated"))?.value).toBe("Absenteeism");
    expect((await row(id, "policy_language"))?.value).toBe(before);
    /* The Action Plan is built, not drafted: a revision that did not name it keeps the built plan. */
    expect((await row(id, "action_plan"))?.value).toBe(plan);
    expect(plan).toBe(`Management will review the Attendance policy with Wren. ${CLOSING}`);
    const system = state.systems.at(-1) ?? "";
    expect(system).toContain("Corrective Action Form");
    expect(system).not.toContain("COACHING IS NOT ALWAYS ABOUT A PROBLEM");
  });

  it("never ticks Termination for the manager", async () => {
    const { id, history } = await createdForm();
    state.toolValues = {};
    state.toolChecked = { warning_type: ["termination"] };
    const answer = await reviseActiveForm({
      request: chat(),
      instanceId: id,
      question: "change the warning to termination",
      history,
      today: "2026-10-20",
    });
    expect((await row(id, "warning_type"))?.checked).toEqual(["verbal"]);
    expect(answer?.content ?? "").not.toMatch(/Type of Warning/);
  });

  it("an offense changed in chat keeps the section Direct policy cites beside its box on Policy Violated", async () => {
    const { id, history } = await createdForm();
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy", history });
    expect((await row(id, "policy_violated"))?.value).toBe("Tardiness/Leaving Early — Late Opening");
    state.toolValues = {};
    state.toolChecked = { offense_type: ["tardiness", "absenteeism"] };

    const answer = await reviseActiveForm({
      request: chat(),
      instanceId: id,
      question: "change the offense to tardiness and absenteeism",
      history,
      today: "2026-10-20",
    });
    expect(answer?.formUpdate?.updated).toEqual(expect.arrayContaining(["offense_type", "policy_violated"]));
    /* District Manager feedback, 21 Oct 2026: the section is named beside its box, as on a first draft. */
    expect((await row(id, "policy_violated"))?.value).toBe("Tardiness/Leaving Early — Late Opening, Absenteeism");
  });

  it("rebuilds a built plan from Policy Violated when the offense changes and no section is cited", async () => {
    const { id, history } = await createdForm();
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "use the late opening policy instead", history });
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "take the late opening policy off the form", history });
    expect((await row(id, "action_plan"))?.value).toBe(
      `Management will review the Tardiness/Leaving Early policy with Wren. ${CLOSING}`,
    );
    state.toolValues = {};
    state.toolChecked = { offense_type: ["absenteeism"] };

    const answer = await reviseActiveForm({
      request: chat(),
      instanceId: id,
      question: "change the offense to absenteeism",
      history,
      today: "2026-10-20",
    });
    expect(answer?.formUpdate?.updated).toEqual(expect.arrayContaining(["offense_type", "policy_violated", "action_plan"]));
    expect((await row(id, "action_plan"))?.value).toBe(`Management will review the Absenteeism policy with Wren. ${CLOSING}`);
  });

  it("changes the Action Plan only when the manager names it, and then leaves their wording alone", async () => {
    const { id, history } = await createdForm();
    state.toolValues = { action_plan: "Wren will retake the attendance training this week." };
    state.toolChecked = {};

    const answer = await reviseActiveForm({
      request: chat(),
      instanceId: id,
      question: "change the action plan to say Wren will retake the attendance training this week",
      history,
      today: "2026-10-20",
    });
    expect(answer?.formUpdate?.updated).toContain("action_plan");
    expect((await row(id, "action_plan"))?.value).toBe(`Wren will retake the attendance training this week. ${CLOSING}`);

    /* Asked for in their words, so a later policy or payroll change does not rebuild it. */
    const policy = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy", history });
    expect(policy?.formUpdate?.updated).toEqual(["policy_language", "policy_violated"]);
    const payroll = await correctActiveForm({
      request: chat(),
      instanceId: id,
      question: "change payroll deduct to yes",
      today: "2026-10-20",
      history,
    });
    expect(payroll?.formUpdate?.updated).toEqual(["payroll_deduct"]);
    expect((await row(id, "action_plan"))?.value).toBe(`Wren will retake the attendance training this week. ${CLOSING}`);
  });

  it("leaves a plan the manager typed on the form when the policy or payroll changes in chat", async () => {
    const { id, history } = await createdForm();
    await saveInstanceValues(id, { values: { action_plan: "Wren and I agreed she will set two alarms." }, checked: {} }, "user-1");
    expect((await row(id, "action_plan"))?.filledBy).toBe("manager");

    const policy = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy", history });
    expect(policy?.formUpdate?.updated).toEqual(["policy_language", "policy_violated"]);
    const payroll = await correctActiveForm({
      request: chat(),
      instanceId: id,
      question: "change payroll deduct to yes, $3.25 will be deducted",
      today: "2026-10-20",
      history,
    });
    expect(payroll?.formUpdate?.updated).toEqual(["payroll_deduct"]);
    expect((await row(id, "action_plan"))?.value).toBe(`Wren and I agreed she will set two alarms. ${CLOSING}`);
  });

  it("puts the deduction in the Action Plan when payroll deduct is changed to Yes, and takes it out on No", async () => {
    const { id, history } = await createdForm();

    const yes = await correctActiveForm({
      request: chat(),
      instanceId: id,
      question: "change payroll deduct to yes, $3.25 will be deducted",
      today: "2026-10-20",
      history,
    });
    expect(yes?.formUpdate?.updated).toEqual(["payroll_deduct", "action_plan"]);
    expect(yes?.content).toMatch(/The Action Plan now states the payroll deduction/);
    expect((await row(id, "action_plan"))?.value).toBe(
      `Management will review the Attendance policy with Wren. $3.25 will be deducted from Wren's pay. ${CLOSING}`,
    );

    const no = await correctActiveForm({
      request: chat(),
      instanceId: id,
      question: "change payroll deduct to no",
      today: "2026-10-20",
      history,
    });
    expect(no?.formUpdate?.updated).toEqual(["payroll_deduct", "action_plan"]);
    expect(no?.content).toMatch(/The Action Plan no longer states a payroll deduction/);
    expect((await row(id, "action_plan"))?.value).toBe(`Management will review the Attendance policy with Wren. ${CLOSING}`);

    /* Yes again, with no amount this turn: no figure is invented. */
    await correctActiveForm({ request: chat(), instanceId: id, question: "change payroll deduct to yes", today: "2026-10-20", history });
    expect((await row(id, "action_plan"))?.value).toBe(
      `Management will review the Attendance policy with Wren. A payroll deduction applies. ${CLOSING}`,
    );
  });

  it("is not a revision when the manager asks for another Corrective Action", async () => {
    const { id, history } = await createdForm();
    expect(
      await reviseActiveForm({
        request: chat(),
        instanceId: id,
        question: "create a new corrective action for Wren Halvorsen",
        history,
        today: "2026-10-20",
      }),
    ).toBeNull();
  });

  it("takes a bare 'no' as the answer to Ask Sunny's own payroll question", async () => {
    const { id, history } = await createdForm();
    const asked: ChatMessage[] = [
      ...history,
      { id: "a3", role: "assistant", content: "One more question: **Is payroll deduct applicable?** Yes or No?", createdAt: "2026-10-20T15:02:00Z" } as ChatMessage,
    ];
    const answer = await correctActiveForm({ request: chat(), instanceId: id, question: "no", today: "2026-10-20", history: asked });
    expect(answer?.formUpdate?.updated).toEqual(["payroll_deduct"]);
    expect((await row(id, "payroll_deduct"))?.checked).toEqual(["no"]);
    // Without that question just before it, "no" answers nothing.
    const elsewhere: ChatMessage[] = [
      ...asked,
      said("what does the manual say about late opening?"),
      { id: "a4", role: "assistant", content: "The Late Opening section says the employee must notify the manager.", createdAt: "2026-10-20T15:03:00Z" } as ChatMessage,
    ];
    expect(await correctActiveForm({ request: chat(), instanceId: id, question: "no", today: "2026-10-20", history: elsewhere })).toBeNull();
  });
});

describe("an ordinary answer knows the form is open", () => {
  it("describes the form, its employee and what it says, for the prompt", async () => {
    const { id } = await createdForm();
    const summary = await describeOpenForm(chat(), id);
    expect(summary).toMatchObject({ templateName: "Corrective Action Form", employeeName: "Wren Halvorsen", status: "draft" });
    expect(summary!.lines.map((line) => line.label)).toEqual(
      expect.arrayContaining(["Type of Warning", "Direct policy from official manual"]),
    );
  });

  it("tells nobody about a form they may not see", async () => {
    const { id } = await createdForm();
    state.scope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };
    expect(await describeOpenForm(chat(), id)).toBeNull();
  });
});

describe("changing to a different form keeps the person the conversation is about", () => {
  it("carries Wren Halvorsen into a Coaching Form asked for well after she was named", async () => {
    const turns = [
      "create corrective action for Wren Halvorsen for Late Opening from the policy manual. It is a verbal warning",
      "can you add late opening policy to the direct policy section of this form",
      "I have independently verified and the policy is correct",
      "what does the manual say about reimbursing the company?",
      "how much is the late opening fee?",
      "and who pays for client restitution?",
      "ok thanks",
    ];
    const history: ChatMessage[] = [];
    for (const turn of turns) {
      history.push(said(turn), { id: `r${sequence}`, role: "assistant", content: "Noted.", createdAt: "2026-10-20T15:00:01Z" } as ChatMessage);
    }
    const response = await proposeFormForTurn({
      history,
      question: "Create a Coaching Form from this conversation.",
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-20",
    });
    expect(response?.formProposal?.templateKey).toBe("coaching");
    expect(response?.formProposal?.employeeName).toBe("Wren Halvorsen");
    expect(response?.content).toContain("from earlier in this conversation");
    expect(response?.content).not.toMatch(/employee's full name/i);
  });
});

describe("a section the form already cites", () => {
  it("is said to be there, and nothing is rewritten", async () => {
    const { id, history } = await createdForm();
    await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "use the late opening policy", history });
    const answer = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "use the late opening policy", history });
    expect(answer?.content).toMatch(/already cites \*\*Late Opening\*\*/);
    expect(answer?.formUpdate).toBeUndefined();
  });
});
