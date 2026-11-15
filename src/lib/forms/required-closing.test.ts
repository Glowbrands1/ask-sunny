import { afterEach, describe, expect, it, vi } from "vitest";

import { fieldsForVariant, parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import {
  CA_ACTION_PLAN_CLOSING,
  CA_ACTION_PLAN_CLOSING_REVISION_5,
  TERMINATION_PLAN_CLOSING,
  applyRequiredClosings,
  closingForDisplay,
  endsWithRequiredClosing,
  withRequiredClosing,
} from "./required-closing";

/**
 * HR feedback, 3 Oct 2026: every Corrective Action Action Plan ends with
 * "Future policy violations may be subject to additional corrective action up
 * to and including termination of employment." District Manager feedback, 21
 * Oct 2026 (revision 6): "… may result in …". Deterministic, never doubled.
 */

const CLOSING = CA_ACTION_PLAN_CLOSING;
const PLAN =
  "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time. Moving forward, Jessica should arrive ready to work at the start of every shift. Management will monitor compliance and provide coaching as needed.";

describe("the closing sentence", () => {
  it("is the business's sentence, exactly", () => {
    expect(CLOSING).toBe(
      "Future policy violations may result in additional corrective action up to and including termination of employment.",
    );
    expect(CA_ACTION_PLAN_CLOSING_REVISION_5).toBe(
      "Future policy violations may be subject to additional corrective action up to and including termination of employment.",
    );
  });

  it("is appended when absent", () => {
    expect(withRequiredClosing(PLAN, CLOSING)).toBe(`${PLAN} ${CLOSING}`);
  });

  it("is not duplicated when already present", () => {
    const once = withRequiredClosing(PLAN, CLOSING);
    expect(withRequiredClosing(once, CLOSING)).toBe(once);
    expect(once.split(CLOSING)).toHaveLength(2);
  });

  it("is applied idempotently, however many times a value is saved", () => {
    let value = PLAN;
    for (let index = 0; index < 5; index += 1) value = withRequiredClosing(value, CLOSING);
    expect(value).toBe(`${PLAN} ${CLOSING}`);
  });

  it("is moved to the end, not printed twice, when text was added after it", () => {
    const edited = `${PLAN} ${CLOSING} Jessica agreed to set an earlier alarm.`;
    const result = withRequiredClosing(edited, CLOSING);
    expect(result).toBe(`${PLAN} Jessica agreed to set an earlier alarm. ${CLOSING}`);
    expect(result.match(/Future policy violations/g)).toHaveLength(1);
  });

  it("collapses a copy with different spacing, casing or end punctuation into the exact one", () => {
    const sloppy = `${PLAN}\nfuture policy violations may result in  additional corrective action up to and including termination of employment`;
    const result = withRequiredClosing(sloppy, CLOSING);
    expect(result.endsWith(CLOSING)).toBe(true);
    expect(result.toLowerCase().match(/future policy violations/g)).toHaveLength(1);
  });

  it("gives a body that stops mid-sentence its full stop", () => {
    expect(withRequiredClosing("Jessica will arrive on time", CLOSING)).toBe(
      `Jessica will arrive on time. ${CLOSING}`,
    );
  });

  it("leaves an empty plan empty, so a plan nobody wrote still reads as unwritten", () => {
    expect(withRequiredClosing("", CLOSING)).toBe("");
    expect(withRequiredClosing("   ", CLOSING)).toBe("   ");
  });

  it("prints alone on a blank form, and with the plan on a filled one", () => {
    expect(closingForDisplay("", CLOSING)).toBe(CLOSING);
    expect(closingForDisplay(PLAN, CLOSING)).toBe(`${PLAN} ${CLOSING}`);
  });

  it("replaces revision 5's wording, wherever it sits, rather than printing both", () => {
    const carried = `${PLAN} ${CA_ACTION_PLAN_CLOSING_REVISION_5}`;
    const result = withRequiredClosing(carried, CLOSING);
    expect(result).toBe(`${PLAN} ${CLOSING}`);
    expect(result.match(/Future policy violations/g)).toHaveLength(1);
    const typedAfter = `${PLAN} ${CA_ACTION_PLAN_CLOSING_REVISION_5} Jessica agreed to this plan.`;
    expect(withRequiredClosing(typedAfter, CLOSING)).toBe(`${PLAN} Jessica agreed to this plan. ${CLOSING}`);
  });

  it("keeps revision 5's wording on a revision-5 form, which prints what was signed", () => {
    const signed = `${PLAN} ${CA_ACTION_PLAN_CLOSING_REVISION_5}`;
    expect(withRequiredClosing(signed, CA_ACTION_PLAN_CLOSING_REVISION_5)).toBe(signed);
    expect(closingForDisplay(signed, CA_ACTION_PLAN_CLOSING_REVISION_5)).toBe(signed);
  });

  it("is what a reader checks for", () => {
    expect(endsWithRequiredClosing(PLAN, CLOSING)).toBe(false);
    expect(endsWithRequiredClosing(`${PLAN} ${CLOSING}`, CLOSING)).toBe(true);
  });
});

describe("which fields carry it", () => {
  const ca = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;
  const document = parseFormDocument(ca.document);

  it("is declared on the Corrective Action Form's Action Plan, in the stored version", () => {
    const plan = fieldsForVariant(document, null).find((field) => field.key === "action_plan")!;
    expect(plan.requiredClosing).toBe(CLOSING);
    // It survives the round trip a published version makes through the database.
    const stored = parseFormDocument(JSON.parse(JSON.stringify(ca.document)));
    expect(fieldsForVariant(stored, null).find((field) => field.key === "action_plan")?.requiredClosing).toBe(CLOSING);
  });

  it("is on no other field of any template", () => {
    for (const seed of TEMPLATE_SEEDS) {
      for (const field of fieldsForVariant(parseFormDocument(seed.document), null)) {
        if (seed.key === "dpoa" && field.key === "action_plan") continue;
        expect(field.requiredClosing, `${seed.key}.${field.key}`).toBeUndefined();
      }
    }
  });

  it("is applied only to the marked field, and only when the write mentions it", () => {
    const values = { action_plan: PLAN, observation: "Observed:\nJessica was late." };
    const result = applyRequiredClosings(document, null, values);
    expect(result.action_plan).toBe(`${PLAN} ${CLOSING}`);
    expect(result.observation).toBe(values.observation);
    // A write that does not touch the plan does not create one.
    expect(applyRequiredClosings(document, null, { observation: "x" })).toEqual({ observation: "x" });
  });

  it("changes nothing on a version that does not declare it (every form filed before revision 5)", () => {
    const revision4 = parseFormDocument({
      ...ca.document,
      blocks: ca.document.blocks.map((block) =>
        block.kind === "field" && block.field.key === "action_plan"
          ? { ...block, field: { ...block.field, requiredClosing: undefined } }
          : block,
      ),
    });
    const values = { action_plan: PLAN };
    expect(applyRequiredClosings(revision4, null, values)).toBe(values);
  });
});

/* Pau's written approval, 15 Nov 2026 (QA relay; batch G8, a production chat): a plan ending in a stated termination keeps no future-violations closing. */
describe("a plan that ends in a stated termination", () => {
  const on = () => vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
  afterEach(() => vi.unstubAllEnvs());
  it("'… has resulted in immediate termination of employment.' gets no closing after it", () => {
    on();
    const plan = "Violation of Company policy has resulted in immediate termination of employment.";
    expect(withRequiredClosing(plan, CA_ACTION_PLAN_CLOSING)).toBe(plan);
  });
  it("'employment has been terminated …' gets no closing after it", () => {
    on();
    const plan = "Due to repeated no call no shows, her employment has been terminated effective 11/15/2026.";
    expect(withRequiredClosing(plan, CA_ACTION_PLAN_CLOSING)).toBe(plan);
  });
  it("a plan that only mentions termination mid-text still ends with the closing", () => {
    on();
    const plan = "Management will review the policy with her; termination of employment is the next step if this repeats. She will clock in on time.";
    expect(withRequiredClosing(plan, CA_ACTION_PLAN_CLOSING)).toBe(`${plan} ${CA_ACTION_PLAN_CLOSING}`);
  });
  it("with the flag off, nothing changes: the closing follows", () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "false");
    const plan = "Violation of Company policy has resulted in immediate termination of employment.";
    expect(withRequiredClosing(plan, CA_ACTION_PLAN_CLOSING)).toBe(`${plan} ${CA_ACTION_PLAN_CLOSING}`);
  });
});

/* Pau's written approval, 15 Nov 2026 (QA relay; batch G8): with Termination ticked, the plan's closing is the termination closing. */
describe("the Action Plan's closing on a form with Termination ticked", () => {
  afterEach(() => vi.unstubAllEnvs());
  const ca = async () => (await import("./library")).correctiveActionDocument();
  it("the manager's own termination sentence (G8's production wording) on a termination form: nothing added", async () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    const plan = "Violation of Company policy has resulted in immediate termination of employment.";
    expect(applyRequiredClosings(await ca(), null, { action_plan: plan }, { terminationTicked: true }).action_plan).toBe(plan);
  });
  it("the same plan on a form with no level: nothing added either (it states the termination)", async () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    const plan = "Violation of Company policy has resulted in immediate termination of employment.";
    expect(applyRequiredClosings(await ca(), null, { action_plan: plan }).action_plan).toBe(plan);
  });
  it("a plain plan on a termination form ends with the termination closing, never the future-violations one", async () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    const closed = applyRequiredClosings(await ca(), null, { action_plan: `Management will review the attendance policy with her. ${CA_ACTION_PLAN_CLOSING}` }, { terminationTicked: true }).action_plan!;
    expect(closed).toBe(`Management will review the attendance policy with her. ${TERMINATION_PLAN_CLOSING}`);
    expect(closed).not.toContain("Future policy violations");
  });
  it("a plain plan with no termination: the closing is unchanged", async () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    expect(applyRequiredClosings(await ca(), null, { action_plan: "Management will review the attendance policy with her." }).action_plan).toBe(`Management will review the attendance policy with her. ${CA_ACTION_PLAN_CLOSING}`);
  });
});

/*
 * QA's review of batch G (15 Nov 2026): only a past or perfect termination closes the plan. A future, modal or present
 * "result in termination" is a warning, so the required closing still follows it, on either kind of form.
 */
describe("a future or modal 'result in termination' never closes the plan", () => {
  afterEach(() => vi.unstubAllEnvs());
  const ca = async () => (await import("./library")).correctiveActionDocument();
  const FUTURE = [
    "Future policy violations may result in termination of employment.",
    "Any further violations will result in termination of employment.",
    "If this happens again it will result in termination of employment.",
    "Another no call no show could result in termination of employment.",
    "Continued violations result in termination of employment.",
  ];
  for (const sentence of FUTURE) {
    it(`on a termination form: "${sentence}" gets the termination closing`, async () => {
      vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
      const plan = `Management reviewed the attendance policy with her. ${sentence}`;
      expect(applyRequiredClosings(await ca(), null, { action_plan: plan }, { terminationTicked: true }).action_plan).toBe(`${plan} ${TERMINATION_PLAN_CLOSING}`);
    });
    it(`on a form with no termination: "${sentence}" keeps the required CA closing`, async () => {
      vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
      const plan = `Management reviewed the attendance policy with her. ${sentence}`;
      expect(applyRequiredClosings(await ca(), null, { action_plan: plan }).action_plan).toBe(`${plan} ${CA_ACTION_PLAN_CLOSING}`);
    });
  }
  it("'… resulted in termination of employment.' and 'employment was terminated …' still close it", () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    for (const plan of ["The violation resulted in termination of employment.", "Her employment was terminated on 11/15/2026."]) {
      expect(withRequiredClosing(plan, CA_ACTION_PLAN_CLOSING)).toBe(plan);
    }
  });
});
