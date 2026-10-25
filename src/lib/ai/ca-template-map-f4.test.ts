import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caTemplateMapEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * QA F4, 24 Oct 2026, exact: "Deterministic layer, raw = null:
 * detectTemplateIntent returns the generic {kind:"corrective_action"} rather
 * than the dpoa template when the request carries a level or no name.
 * "create a Verbal CA for Test Employee…", "create a verbal corrective
 * action…", "write a verbal CA for Team Member…" and "I need a CA for someone
 * opening the store late" all give templateKey null. Live, the model masks
 * this, but it's fragile. Map corrective_action to the published CA template."
 *
 * Ask Sunny's live form path is the intent read (INTENT_EXTRACTION_ENABLED),
 * then the form proposal. Each case runs both with the model reading absent.
 * The last QA sentence says "store"; this app's manager says "salon". The
 * Ask Bubbles turn of 24 Oct ("write a verbal CA for Team Member, …") is
 * replayed with this app's salon. Synthetic people only.
 *
 * The full remap (FORM_FULL_REMAP_ENABLED, off here, on in Ask Bubbles) is
 * the same code as Ask Bubbles' live path. It already reads "CA" as the
 * form; its gap was the question, which it answered with a Corrective Action
 * Form. Both are kept as tests.
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

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";
const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("./form-proposal");
const { decideIntentTurn } = await import("./intent-slots");
const { remapFormTurn, remapShouldRun } = await import("./form-full-remap");

const SCOPE: AccessScope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
const SALONS = [{ id: "loc-0309", name: "NE Kearney" }];
const TODAY = "2026-10-24";

const ACCEPTANCE = [
  "create a Verbal CA for Test Employee",
  "create a verbal corrective action",
  "write a verbal CA for Team Member",
  "I need a CA for someone opening the salon late",
  // The Ask Bubbles manager's turn of 24 Oct, with this app's salon.
  "write a verbal CA for Team Member, Testy Testerson at NE Kearney. On 10-20-26 Testy was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
];

/** What the intent read keeps, as `applyIntentExtraction` hands it the active published templates. */
async function intentTurn(question: string, history: { role: string; content: string }[] = []) {
  const summaries = await listTemplateSummaries();
  return decideIntentTurn({
    question,
    history,
    today: TODAY,
    saved: null,
    raw: null,
    people: [],
    salons: SALONS,
    headings: ["Attendance", "Late Opening", "Standards of Conduct"],
    templates: summaries.filter((row) => row.active).map((row) => ({ key: row.key, name: row.name })),
    formInProgress: false,
  });
}

/** The live order: the intent read, then the form proposal on the question it returns. */
async function liveTurn(question: string) {
  const decision = await intentTurn(question);
  const response = await proposeFormForTurn({
    history: [] as ChatMessage[],
    question: decision.question,
    questionMessageId: "u1",
    actor: { role: "salon_director" as never, scope: SCOPE },
    summaries: await listTemplateSummaries(),
    today: TODAY,
    policyManual: async () => null,
  });
  return { decision, proposal: response?.formProposal };
}

/** server-ask's remap gate, then the remap with no model reading. */
async function remapTurn(question: string) {
  const formsTurn = detectTemplateIntent(question).kind !== "none";
  const runs = remapShouldRun({ question, history: [], formsTurn });
  const response = runs
    ? await remapFormTurn({ question, history: [], today: TODAY, people: [] }, async () => ({
        raw: null,
        model: "test",
        inputTokens: null,
        outputTokens: null,
      }))
    : null;
  return { runs, proposal: response?.formProposal };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T18:00:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("CA_TEMPLATE_MAP_ENABLED", () => {
  it("defaults off", () => {
    expect(caTemplateMapEnabled()).toBe(false);
  });

  it("the Corrective Action Form is published as dpoa", async () => {
    const summaries = await listTemplateSummaries();
    expect(summaries.find((row) => row.key === "dpoa")?.name).toBe("Corrective Action Form");
  });

  it.each(ACCEPTANCE)("on, %s keeps the Corrective Action Form with no model reading", async (question) => {
    vi.stubEnv("CA_TEMPLATE_MAP_ENABLED", "true");
    const { decision, proposal } = await liveTurn(question);
    expect(decision.state.templateKey).toBe("dpoa");
    expect(decision.formTurn).toBe(true);
    expect(proposal?.templateKey).toBe("dpoa");
  });

  it.each(ACCEPTANCE.slice(0, 4))("off, %s keeps no form in the intent read, as QA found", async (question) => {
    const decision = await intentTurn(question);
    expect(decision.state.templateKey).toBeNull();
  });

  it("on, the next answer stays on the Corrective Action Form", async () => {
    vi.stubEnv("CA_TEMPLATE_MAP_ENABLED", "true");
    const first = await intentTurn("create a Verbal CA for Test Employee");
    const summaries = await listTemplateSummaries();
    const next = decideIntentTurn({
      question: "no payroll",
      history: [
        { role: "user", content: "create a Verbal CA for Test Employee" },
        { role: "assistant", content: "Which salon?" },
      ],
      today: TODAY,
      saved: first.state,
      raw: null,
      people: [],
      salons: SALONS,
      headings: [],
      templates: summaries.filter((row) => row.active).map((row) => ({ key: row.key, name: row.name })),
      formInProgress: Boolean(first.state.templateKey),
    });
    expect(next.state.templateKey).toBe("dpoa");
    expect(next.formTurn).toBe(true);
  });
});

describe("CA_TEMPLATE_MAP_ENABLED leaves the other readings alone", () => {
  beforeEach(() => {
    vi.stubEnv("CA_TEMPLATE_MAP_ENABLED", "true");
  });

  it("coaching form for Test Employee stays the Coaching Form", async () => {
    const { decision, proposal } = await liveTurn("coaching form for Test Employee");
    expect(decision.state.templateKey).toBe("coaching");
    expect(proposal?.templateKey).toBe("coaching");
  });

  it("what does a verbal CA mean? creates nothing", async () => {
    const { decision, proposal } = await liveTurn("what does a verbal CA mean?");
    expect(decision.state.templateKey).toBeNull();
    expect(decision.formTurn).toBe(false);
    expect(proposal).toBeUndefined();
  });

  it("follow-up coaching stays the Follow-Up Coaching Form", async () => {
    const { decision, proposal } = await liveTurn("follow-up coaching for Test Employee");
    expect(decision.state.templateKey).toBe("follow-up-coaching");
    expect(proposal?.templateKey).toBe("follow-up-coaching");
  });

  it("a metric on its own stays the progression, as the form proposal reads it", async () => {
    const decision = await intentTurn("Their Club Close is low, create a corrective action");
    expect(decision.state.templateKey).toBeNull();
  });
});

/*
 * INTEGRATION, CA_TEMPLATE_MAP_ENABLED + FORM_CHOICE_STATED_ENABLED. With both
 * on, the stated-form reader read "create a corrective action" as the
 * Corrective Action Form and bypassed CA_TEMPLATE_MAP's metric-only rule. It
 * now honours that rule; FORM_CHOICE_STATED alone is unchanged.
 */
describe("CA_TEMPLATE_MAP_ENABLED with FORM_CHOICE_STATED_ENABLED on too", () => {
  beforeEach(() => {
    vi.stubEnv("CA_TEMPLATE_MAP_ENABLED", "true");
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
  });

  it("a metric on its own stays the progression", async () => {
    const decision = await intentTurn("Their Club Close is low, create a corrective action");
    expect(decision.state.templateKey).toBeNull();
  });

  it.each(ACCEPTANCE)("%s keeps the Corrective Action Form", async (question) => {
    const { decision, proposal } = await liveTurn(question);
    expect(decision.state.templateKey).toBe("dpoa");
    expect(proposal?.templateKey).toBe("dpoa");
  });

  it("FORM_CHOICE_STATED alone still reads the stated Corrective Action", async () => {
    vi.stubEnv("CA_TEMPLATE_MAP_ENABLED", "false");
    const decision = await intentTurn("Their Club Close is low, create a corrective action");
    expect(decision.state.templateKey).toBe("dpoa");
  });
});

describe("the full remap (FORM_FULL_REMAP_ENABLED), as Ask Bubbles runs it", () => {
  beforeEach(() => {
    vi.stubEnv("FORM_FULL_REMAP_ENABLED", "true");
  });

  it.each(ACCEPTANCE)("%s proposes the Corrective Action Form with no model reading", async (question) => {
    const { runs, proposal } = await remapTurn(question);
    expect(runs).toBe(true);
    expect(proposal?.templateKey).toBe("dpoa");
  });

  it.each(["what does a verbal CA mean?", "what is corrective action?", "Does a verbal CA expire?"])(
    "%s does not run the remap, so nothing is created",
    async (question) => {
      const { runs, proposal } = await remapTurn(question);
      expect(runs).toBe(false);
      expect(proposal).toBeUndefined();
    },
  );

  it("coaching form and follow-up coaching keep their own forms", async () => {
    expect((await remapTurn("coaching form for Test Employee")).proposal?.templateKey).toBe("coaching");
    expect((await remapTurn("follow-up coaching for Test Employee")).proposal?.templateKey).toBe("follow-up-coaching");
  });
});
