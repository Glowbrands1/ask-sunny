import { afterEach, describe, expect, it } from "vitest";

import { flaggedCitationWrite } from "@/lib/ai/policy-citation-fields";
import type { AccessScope, ChatMessage } from "@/types";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";
import { incidentDateOnForm } from "./form-date-answer";
import { HR_TEMPLATE_SEEDS } from "./library";
import { payrollAskAmount, payrollDeductFromConversation } from "./payroll-deduct";
import { extractEmployeeNames, managerContext, resolveEmployee } from "./proposal";
import { policyFieldsWithCitation } from "./required-policy-citation";
import { statedWarningLevel } from "./warning-level";

/**
 * Form input the manager already gave, behind flags that default off.
 *
 * The sentences are the ones reported from live Sunny chats, including
 * the incident date on conv_mvmejcz6corv0n3 (Sunny P3) that was filed as
 * the day the form was created.
 */

const TODAY = "2026-10-24";
const FLAGS = [
  "WARNING_LEVEL_EXPLICIT_ENABLED",
  "POLICY_READS_AS_ENABLED",
  "PERSON_NAME_ONLY_ENABLED",
  "PAYROLL_EXPLICIT_DEDUCT_ENABLED",
  "CITATION_APPEND_ONLY_ENABLED",
  "INCIDENT_DATE_ON_FORM_ENABLED",
] as const;

const CASH_DRAWER =
  "Create a corrective action for Test Employee at Lawrence. Cash drawer was $40 short.";

const ATTENDANCE = { heading: "Attendance", page: 14, chunkIndex: 1, foundBy: "page_heading" as const };

const LATE_CHUNK = {
  chunkIndex: 4,
  page: 16,
  printedPage: 15,
  section: "Late Opening",
  content: "Late Opening\n15 | P a g e\nA salon opens at the posted time.",
  sections: [{ heading: "Late Opening", page: 15 }],
};

const ONE: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };

const LIBRARY = HR_TEMPLATE_SEEDS.filter((seed) => seed.key === "dpoa").map((seed) => ({
  id: "tpl-dpoa",
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: "v-dpoa", status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

function flag(name: (typeof FLAGS)[number], on: boolean) {
  if (on) process.env[name] = "on";
  else delete process.env[name];
}

function payroll(text: string) {
  return payrollDeductFromConversation([{ role: "user", content: text }], { fromThisForm: true });
}

afterEach(() => {
  for (const name of FLAGS) delete process.env[name];
});

describe("warning level is only what the manager stated", () => {
  it("reads a labelled write-up as Written Warning while the flag is off", () => {
    expect(statedWarningLevel("type of warning - written up")).toBe("written");
    expect(statedWarningLevel("write up")).toBeNull();
  });

  it("leaves write up and written up for the manager", () => {
    flag("WARNING_LEVEL_EXPLICIT_ENABLED", true);
    expect(statedWarningLevel("write up")).toBeNull();
    expect(statedWarningLevel("type of warning - written up")).toBeNull();
    expect(statedWarningLevel("tess varga needs a write up")).toBeNull();
    expect(statedWarningLevel("type of warning: written")).toBe("written");
    expect(statedWarningLevel("issue a written")).toBe("written");
    expect(statedWarningLevel("I'd like to issue Remy Calder a verbal for showing up late on 10/18/26.")).toBe(
      "verbal",
    );
  });
});

describe("as you said only when the manager named the policy", () => {
  it("says as you said for an inferred dress code while the flag is off", () => {
    const line = caPolicyProposalLine(readCaPolicy("she wore leggings"))!;
    expect(line).toContain("Dress Code, as you said");
  });

  it("says reads as for leggings and opened late, and as you said when the policy is named", () => {
    flag("POLICY_READS_AS_ENABLED", true);
    expect(caPolicyProposalLine(readCaPolicy("she wore leggings"))).toBe(
      "**Policy:** this reads as **Dress Code**. I'll quote that section from the current policy manual on the draft.",
    );
    expect(caPolicyProposalLine(readCaPolicy("the salon opened late"))).toBe(
      "**Policy:** this reads as **Late Opening**. I'll quote that section from the current policy manual on the draft.",
    );
    expect(caPolicyProposalLine(readCaPolicy("dress code, mini skirt"))).toContain("Dress Code, as you said");
    expect(caPolicyProposalLine(readCaPolicy("late opening"))).toContain("Late Opening, as you said");
  });
});

describe("cash drawer and a store are not employee names", () => {
  it("offers cash drawer beside the employee while the flag is off", () => {
    expect(extractEmployeeNames(CASH_DRAWER)).toEqual(["Test", "Cash drawer"]);
  });

  it("drops cash drawer and a bare store name, and keeps a person whose name shares the store", () => {
    flag("PERSON_NAME_ONLY_ENABLED", true);
    expect(extractEmployeeNames(CASH_DRAWER)).toEqual(["Test"]);
    expect(resolveEmployee(managerContext([], { id: "m", content: CASH_DRAWER })).kind).toBe("resolved");
    expect(extractEmployeeNames("create a corrective action for Lawrence")).toEqual([]);
    expect(extractEmployeeNames("coaching form for lawrence smith").join(" ").toLowerCase()).toContain("lawrence smith");
    expect(extractEmployeeNames("the employee is Pat Kearney")).toEqual(["Pat Kearney"]);
  });
});

describe("a register short is not a payroll deduction", () => {
  it("does not read $40 short as Yes, and misses payroll deduct yes $40, while the flag is off", () => {
    expect(payroll("The cash drawer was $40 short at close.")).toBeNull();
    expect(payroll("$40 short")).toBeNull();
    expect(payroll("payroll deduct yes $40")).toBeNull();
    expect(payroll("deduct the $40 shortage from her paycheck")).toBe("yes");
  });

  it("sets Yes only for an explicit deduction ask and keeps the amount", () => {
    flag("PAYROLL_EXPLICIT_DEDUCT_ENABLED", true);
    expect(payroll("The cash drawer was $40 short at close.")).toBeNull();
    expect(payroll("$40 short")).toBeNull();
    expect(payrollAskAmount("$40 short")).toBeNull();
    expect(payroll("payroll deduct yes $40")).toBe("yes");
    expect(payrollAskAmount("payroll deduct yes $40")).toBe("$40");
    expect(payroll("deduct the $40 shortage from her paycheck")).toBe("yes");
    expect(payrollAskAmount("deduct the $40 shortage from her paycheck")).toBe("$40");
    expect(payroll("payroll deduct $40")).toBe("yes");
    expect(payrollAskAmount("payroll deduct $40")).toBe("$40");
  });
});

describe("a citation is appended only where there is already text", () => {
  it("replaces an empty field with the citation while the flag is off", () => {
    const values = policyFieldsWithCitation({
      attendance: false,
      pageRequired: true,
      values: { policy_language: "", coaching_details: "", follow_up_observation: "" },
      sections: [ATTENDANCE],
    });
    expect(values.policy_language).toBe("Attendance Policy, JBA Policy Manual p.14");
    expect(values.coaching_details).toBe("Attendance Policy, JBA Policy Manual p.14");
    expect(values.follow_up_observation).toBe("Attendance Policy, JBA Policy Manual p.14");
  });

  it("leaves empty Observation, coaching and policy fields empty, and appends when they have text", () => {
    flag("CITATION_APPEND_ONLY_ENABLED", true);
    const empty = policyFieldsWithCitation({
      attendance: false,
      pageRequired: true,
      values: { policy_language: "", coaching_details: "", follow_up_observation: "" },
      sections: [ATTENDANCE],
    });
    expect(empty.policy_language).toBe("");
    expect(empty.coaching_details).toBe("");
    expect(empty.follow_up_observation).toBe("");

    const filled = policyFieldsWithCitation({
      attendance: false,
      pageRequired: true,
      values: { coaching_details: "Out of dress code.", follow_up_observation: "She was on time." },
      sections: [ATTENDANCE],
    });
    expect(filled.coaching_details).toContain("Out of dress code.");
    expect(filled.coaching_details).toContain("Attendance Policy, JBA Policy Manual p.14");
    expect(filled.follow_up_observation).toContain("She was on time.");
    expect(filled.follow_up_observation).toContain("Attendance Policy, JBA Policy Manual p.14");
  });

  it("does not plant the older policy reference into an empty observation when page-required is off", () => {
    const older = flaggedCitationWrite({
      enabled: true,
      templateKey: "follow-up-coaching",
      values: { follow_up_observation: "" },
      notes: "She was late opening the salon.",
      chunks: [LATE_CHUNK],
    });
    expect(older.values.follow_up_observation).toContain("Policy reference: Late Opening Policy, JBA Policy Manual p.15");

    flag("CITATION_APPEND_ONLY_ENABLED", true);
    const held = flaggedCitationWrite({
      enabled: true,
      templateKey: "follow-up-coaching",
      values: { follow_up_observation: "" },
      notes: "She was late opening the salon.",
      chunks: [LATE_CHUNK],
    });
    expect(held.values.follow_up_observation).toBe("");

    const appended = flaggedCitationWrite({
      enabled: true,
      templateKey: "coaching",
      values: { coaching_details: "She opened the salon late." },
      notes: "She was late opening the salon.",
      chunks: [LATE_CHUNK],
    });
    expect(appended.values.coaching_details).toContain("She opened the salon late.");
    expect(appended.values.coaching_details).toContain("Policy reference: Late Opening Policy, JBA Policy Manual p.15");
  });
});

describe("the form date is the incident date, not today", () => {
  it("leaves a skipped incident day undated while the flag is off", () => {
    expect(incidentDateOnForm("she was late on the 20th", TODAY)).toBeNull();
    expect(incidentDateOnForm("she no showed yesterday", TODAY)).toBeNull();
    expect(incidentDateOnForm("it happened on 10-20", TODAY)).toBeNull();
  });

  it("uses the incident day the manager gave", () => {
    flag("INCIDENT_DATE_ON_FORM_ENABLED", true);
    expect(incidentDateOnForm("she was late on the 20th", TODAY)).toBe("2026-10-20");
    expect(incidentDateOnForm("she no showed yesterday", TODAY)).toBe("2026-10-23");
    expect(incidentDateOnForm("it happened on 10-20", TODAY)).toBe("2026-10-20");
    expect(incidentDateOnForm("she was late last Tuesday", TODAY)).toBe("2026-10-20");
    expect(incidentDateOnForm("she was late on 10/20/26", TODAY)).toBe("2026-10-20");
    expect(incidentDateOnForm("she was late today", TODAY)).toBeNull();
    expect(incidentDateOnForm("she was late on the 12th and the 15th", TODAY)).toBeNull();
  });
});

describe("the proposal carries the incident date", () => {
  it("dates the corrective action with the day in the request", async () => {
    const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
    const question = "create a verbal ca for pat rivera, she was late on the 20th. no payroll deduct";
    const message = { id: "u1", role: "user", content: question, createdAt: "2026-10-24T15:00:00Z" } as ChatMessage;
    const bare = await proposeFormForTurn({
      history: [],
      question,
      questionMessageId: message.id,
      actor: { role: "salon_director", scope: ONE },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(bare?.formProposal?.formDate ?? null).toBeNull();

    flag("INCIDENT_DATE_ON_FORM_ENABLED", true);
    const dated = await proposeFormForTurn({
      history: [],
      question,
      questionMessageId: "u2",
      actor: { role: "salon_director", scope: ONE },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(dated?.formProposal?.employeeName).toMatch(/pat rivera/i);
    expect(dated?.formProposal?.formDate).toBe("2026-10-20");
  });
});
