import { afterEach, describe, expect, it } from "vitest";

import { formDateBrief, resolveFormDate } from "./form-date-grounding";
import { fieldsFromManagerText, corroborateModelFields } from "@/lib/ai/form-field-state";

import { isNonTitleFollowUp, resolveStatedFormDate } from "./form-input-fidelity";

/**
 * Saturday 24 Oct 2026. "last Tuesday" is 20 Oct. "yesterday" is 23 Oct.
 * A null form date is dated today when the draft is created
 * (`instances.ts` seeds `form_date` from the proposal date or today).
 */
const TODAY = "2026-10-24";

const FLAGS = ["FORM_INPUT_FIDELITY_ENABLED"] as const;

afterEach(() => {
  for (const name of FLAGS) delete process.env[name];
});

function draftLine(formDate: string | null): string {
  const iso = formDate ?? TODAY;
  return formDateBrief(resolveFormDate(iso)!);
}

describe("typed incident dates", () => {
  it("keeps Oct 20 and 10/20, and leaves yesterday and last Tuesday unresolved, when the flag is off", () => {
    expect(resolveStatedFormDate("Oct 20", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("10/20", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("yesterday", TODAY)).toBeNull();
    expect(resolveStatedFormDate("last Tuesday", TODAY)).toBeNull();
    expect(resolveStatedFormDate("She wore slippers yesterday.", TODAY)).toBeNull();

    for (const typed of ["yesterday", "last Tuesday"]) {
      const fields = fieldsFromManagerText(typed, TODAY);
      expect(fields.useToday, typed).toBe(true);
      expect(fields.incidentDateIso, typed).toBe(TODAY);
      expect(draftLine(resolveStatedFormDate(typed, TODAY)), typed).toContain("October 24, 2026");
    }
    expect(draftLine(resolveStatedFormDate("Oct 20", TODAY))).toContain("October 20, 2026");
    expect(draftLine(resolveStatedFormDate("10/20", TODAY))).not.toContain("October 24, 2026");
  });

  it("keeps the typed or resolved date, and uses today only when no date was given, when the flag is on", () => {
    process.env.FORM_INPUT_FIDELITY_ENABLED = "1";
    expect(resolveStatedFormDate("Oct 20", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("10/20", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("yesterday", TODAY)).toBe("2026-10-23");
    expect(resolveStatedFormDate("last Tuesday", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("She wore slippers yesterday.", TODAY)).toBe("2026-10-23");
    expect(resolveStatedFormDate("She wore slippers last Tuesday.", TODAY)).toBe("2026-10-20");
    expect(resolveStatedFormDate("today", TODAY)).toBeNull();
    expect(resolveStatedFormDate("She wore slippers.", TODAY)).toBeNull();
    expect(resolveStatedFormDate("got a verbal warning yesterday", TODAY)).toBeNull();

    for (const [typed, iso] of [
      ["Oct 20", "2026-10-20"],
      ["10/20", "2026-10-20"],
      ["yesterday", "2026-10-23"],
      ["last Tuesday", "2026-10-20"],
    ] as const) {
      const fields = fieldsFromManagerText(`Date of Occurrence: ${typed}`, TODAY);
      expect(fields.useToday, typed).toBe(false);
      expect(fields.incidentDateIso, typed).toBe(iso);
      expect(draftLine(iso), typed).toContain(
        iso === "2026-10-23" ? "October 23, 2026" : "October 20, 2026",
      );
      expect(draftLine(iso), typed).not.toContain("October 24, 2026");
    }

    const today = fieldsFromManagerText("Use today's date", TODAY);
    expect(today.useToday).toBe(true);
    expect(today.incidentDateIso).toBe(TODAY);
  });
});

describe("bare follow-ups are not job titles", () => {
  const model = {
    employeeName: null,
    salon: null,
    incidentDateIso: null,
    useToday: false,
    payrollDeduct: null,
    payrollAmount: null,
    warningLevel: null,
    policySection: null,
    deadline: null,
  };

  it.each(["verbal", "written", "yes", "Monday"])(
    "flag off still stores %s when the model copied it into the title",
    (reply) => {
      expect(isNonTitleFollowUp(reply)).toBe(true);
      const fields = corroborateModelFields(
        fieldsFromManagerText(reply, TODAY),
        { ...model, jobTitle: reply },
        reply,
        TODAY,
      );
      expect(fields.jobTitle).toBe(reply);
    },
  );

  it.each(["verbal", "written", "yes", "Monday"])(
    "flag on leaves %s off the job title",
    (reply) => {
      process.env.FORM_INPUT_FIDELITY_ENABLED = "1";
      const fields = corroborateModelFields(
        fieldsFromManagerText(reply, TODAY),
        { ...model, jobTitle: reply },
        reply,
        TODAY,
      );
      expect(fields.jobTitle).toBeNull();
    },
  );

  it("still keeps a title the manager stated", () => {
    process.env.FORM_INPUT_FIDELITY_ENABLED = "1";
    const text = "Jordan Lee is a team member";
    const fields = corroborateModelFields(
      fieldsFromManagerText(text, TODAY),
      { ...model, jobTitle: "team member" },
      text,
      TODAY,
    );
    expect(fields.jobTitle).toBe("team member");
    expect(isNonTitleFollowUp("Tanning Consultant")).toBe(false);
  });
});
