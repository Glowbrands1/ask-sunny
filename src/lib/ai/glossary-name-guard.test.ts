import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { managerContext, readEmployeeMentions, resolveEmployee } from "@/lib/forms/proposal";
import { correctiveActionIntakeRequest, readCorrectiveActionIntake } from "@/lib/forms/corrective-action-intake";
import { namesSomebody } from "@/lib/forms/answer-not-a-name";
import { checkReading } from "@/lib/ai/reader/check";
import { parseFormReading } from "@/lib/ai/reader/schema";

/**
 * CHAT_GLOSSARY_ENABLED: the code guard, on QA's sf-s12 wording, exactly:
 * "I need to make a corrective action for msb". Ported from Ask Bubbles
 * (40146f84, #419). With the flag on, "msb" is never the employee, and the
 * Corrective Action intake asks this app's existing one question, "Who is
 * this form for? Tell me the employee's full name.". Off, main's reading:
 * "msb" is the employee.
 *
 * Name mapping: Bubbles guards `keepTypedPerson` (`forms/typed-name.ts`),
 * which this app does not have; here every name `readEmployeeMentions`
 * returns already passes `namesSomebody`, which `employeeState` (and so
 * `resolveEmployee`) reads.
 */
const SAID = "I need to make a corrective action for msb";
const FLAGS = ["CHAT_GLOSSARY_ENABLED", "NAME_QUESTION_ONLY_ENABLED"] as const;
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function context(text: string) {
  return managerContext([], { id: "m0", content: text });
}

describe(`"${SAID}"`, () => {
  it("flag off: read as main reads it — msb is the employee", () => {
    expect(readEmployeeMentions(SAID).names).toEqual(["msb"]);
    expect(resolveEmployee(context(SAID))).toEqual({ kind: "resolved", employeeName: "msb" });
    expect(namesSomebody("Msb")).toBe(true);
  });

  it("flag on: msb is never a name candidate nor the employee", () => {
    process.env.CHAT_GLOSSARY_ENABLED = "true";
    expect(readEmployeeMentions(SAID).names).toEqual([]);
    expect(resolveEmployee(context(SAID))).toEqual({ kind: "missing" });
    // "MSB", "Msb" and "M.S.B." fold to the same term.
    expect(readEmployeeMentions("I need to make a corrective action for MSB").names).toEqual([]);
    expect(namesSomebody("Msb")).toBe(false);
    expect(namesSomebody("M.S.B.")).toBe(false);
  });

  it("flag on: a real person beside MSB is still the employee", () => {
    process.env.CHAT_GLOSSARY_ENABLED = "true";
    expect(readEmployeeMentions("Create a Corrective Action for Thea Quillfeather for msb").names).toEqual(["Thea Quillfeather"]);
  });

  it("flag on: the reader's employee \"msb\" is dropped; off, as main", () => {
    const reading = parseFormReading({ employee: { value: "msb", evidence: "corrective action for msb" } });
    expect(reading).not.toBeNull();
    const check = () => checkReading(reading!, { managerTurns: [SAID], people: [], locations: [], headings: [], today: "2026-10-26" });
    const off = check();
    process.env.CHAT_GLOSSARY_ENABLED = "true";
    const on = check();
    expect(off.employee?.name.toLowerCase()).toBe("msb");
    expect(on.employee).toBeNull();
  });

  it("flag on: the intake asks the existing one question, once; off, the list as on main", () => {
    const ask = () =>
      correctiveActionIntakeRequest({
        formName: "Corrective Action Form",
        items: readCorrectiveActionIntake({ text: SAID, employeeKnown: false, salonSettled: true }).missing,
        opening: true,
        today: "October 26, 2026",
      });
    expect(ask()).toMatch(/^Great, I can help you create a \*\*Corrective Action Form\*\*/);
    process.env.CHAT_GLOSSARY_ENABLED = "true";
    expect(ask()).toBe("Who is this form for? Tell me the employee's full name.");
  });
});
