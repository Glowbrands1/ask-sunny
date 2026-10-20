import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";

/**
 * A Corrective Action Form created from "create ca for Ellie Sendgraff" comes
 * back blank, because nothing was described. When the manager then says what
 * happened, the form on screen is redrafted through the drafting route — the
 * one that cites the manual's section and page — rather than a new form made.
 */

const state = vi.hoisted(() => ({
  templateKey: "dpoa",
  status: "draft",
  authorized: true,
  values: [] as { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[],
  draftCalls: [] as { id: string; body: Record<string, unknown>; cookie: string | null }[],
  draftStatus: 200,
  draftResult: {} as Record<string, unknown>,
}));

vi.mock("./instance-scope", () => ({
  authorizeInstance: async () => {
    if (!state.authorized) throw new Error("not permitted");
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === state.templateKey)!;
    return {
      actor: { id: "user-1", role: "salon_director", verified: true, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          variantKey: null,
          employeeName: "Ellie Sendgraff",
          status: state.status,
        },
        version: { document: parseFormDocument(seed.document), variants: [] },
        values: state.values.map((row) => ({ ...row, provenance: {} })),
      },
    };
  },
}));

vi.mock("@/app/api/forms/instances/[id]/draft/route", () => ({
  POST: async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    state.draftCalls.push({
      id,
      body: (await request.json()) as Record<string, unknown>,
      cookie: request.headers.get("cookie"),
    });
    return new Response(JSON.stringify(state.draftResult), {
      status: state.draftStatus,
      headers: { "content-type": "application/json" },
    });
  },
}));

const { redraftActiveForm } = await import("./chat-redraft");

const INSTANCE = "11111111-1111-1111-1111-111111111111";

const redraft = (question: string) =>
  redraftActiveForm({
    request: new Request("http://localhost/api/chat", { method: "POST", headers: { cookie: "session=abc" } }),
    instanceId: INSTANCE,
    question,
    history: [
      { id: "m1", role: "user", content: "create ca for Ellie Sendgraff" },
      { id: "m2", role: "assistant", content: "I can create a **Corrective Action Form** for **Ellie Sendgraff**." },
    ],
  });

beforeEach(() => {
  state.templateKey = "dpoa";
  state.status = "draft";
  state.authorized = true;
  state.values = [];
  state.draftCalls = [];
  state.draftStatus = 200;
  state.draftResult = {
    values: {
      observation: "Observed: …",
      policy_violated: "Tardiness/Leaving Early",
      policy_language: "When an employee assigned to open…\n\nSource: JBA Policy Manual — Late Opening, p. 15",
    },
    checked: { offense_type: ["tardiness"] },
    policyDerived: ["policy_violated", "policy_language"],
  };
});

describe("redrafting a blank Corrective Action Form from what the manager says next", () => {
  it("redrafts the form on screen from the whole account, as the manager", async () => {
    const response = await redraft(
      "On October 16th Ellie was scheduled to open the salon at 9:30am and did not arrive until 11:23am",
    );

    expect(state.draftCalls).toHaveLength(1);
    expect(state.draftCalls[0]!.id).toBe(INSTANCE);
    expect(state.draftCalls[0]!.cookie).toBe("session=abc");
    expect(state.draftCalls[0]!.body.keepManagerValues).toBe(true);
    expect(String(state.draftCalls[0]!.body.notes)).toContain("create ca for Ellie Sendgraff");
    expect(String(state.draftCalls[0]!.body.notes)).toContain("did not arrive until 11:23am");

    expect(response!.content).toMatch(/Redrafted the \*\*Corrective Action Form\*\* for \*\*Ellie Sendgraff\*\*/);
    expect(response!.content).toMatch(/cites its section and page/);
    expect(response!.formUpdate).toEqual({
      instanceId: INSTANCE,
      updated: ["observation", "policy_violated", "policy_language", "offense_type"],
    });
  });

  it("says so when the account matched no section of the manual", async () => {
    state.draftResult = { values: { observation: "Observed: …" }, checked: {}, policyDerived: [] };
    const response = await redraft("Ellie rang up her own tan package against policy yesterday");

    expect(response!.content).toMatch(/couldn't match what you described to a section of the policy manual/);
  });

  it("tells the manager what they typed is kept", async () => {
    state.values = [{ fieldKey: "warning_level_note", value: "Verbal", checked: [], filledBy: "manager" }];
    const response = await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23");

    expect(response!.content).toMatch(/kept as you wrote it/);
  });

  it("reports a failed redraft and leaves the form alone", async () => {
    state.draftStatus = 429;
    state.draftResult = { error: "Too many requests. Try again in 30 seconds." };
    const response = await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23");

    expect(response!.content).toMatch(/couldn't redraft/);
    expect(response!.content).toMatch(/Too many requests/);
    expect(response!.formUpdate).toBeUndefined();
  });

  it.each([
    ["a question", "what does the attendance policy say?"],
    ["a bare acknowledgement", "ok thanks"],
    ["somebody else", "Jordan Smith was late today too"],
    ["a different form", "create a coaching form for Ellie Sendgraff"],
  ])("leaves %s to the ordinary answer", async (_label, question) => {
    expect(await redraft(question)).toBeNull();
    expect(state.draftCalls).toHaveLength(0);
  });

  it("does nothing once Sunny has already drafted the form", async () => {
    state.values = [{ fieldKey: "observation", value: "Observed: Ellie arrived late.", checked: [], filledBy: "ai" }];
    expect(await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23")).toBeNull();
    expect(state.draftCalls).toHaveLength(0);
  });

  it("does nothing on a finalized form, or one the actor may not edit", async () => {
    state.status = "finalized";
    expect(await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23")).toBeNull();
    state.status = "draft";
    state.authorized = false;
    expect(await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23")).toBeNull();
    expect(state.draftCalls).toHaveLength(0);
  });

  it("does nothing on a form that cites no policy", async () => {
    state.templateKey = "coaching";
    expect(await redraft("Ellie was scheduled at 9:30 and did not arrive until 11:23")).toBeNull();
    expect(state.draftCalls).toHaveLength(0);
  });
});
