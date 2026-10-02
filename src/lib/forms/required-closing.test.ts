import { describe, expect, it } from "vitest";

import { fieldsForVariant, parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import {
  CA_ACTION_PLAN_CLOSING,
  applyRequiredClosings,
  closingForDisplay,
  endsWithRequiredClosing,
  withRequiredClosing,
} from "./required-closing";

/**
 * HR feedback, 3 Oct 2026: every Corrective Action Action Plan ends with
 * "Future policy violations may be subject to additional corrective action up
 * to and including termination of employment." Deterministic, never doubled.
 */

const CLOSING = CA_ACTION_PLAN_CLOSING;
const PLAN =
  "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time. Moving forward, Jessica should arrive ready to work at the start of every shift. Management will monitor compliance and provide coaching as needed.";

describe("the closing sentence", () => {
  it("is the business's sentence, exactly", () => {
    expect(CLOSING).toBe(
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
    const sloppy = `${PLAN}\nfuture policy violations may be subject to  additional corrective action up to and including termination of employment`;
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
