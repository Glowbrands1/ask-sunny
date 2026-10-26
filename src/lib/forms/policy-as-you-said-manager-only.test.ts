import { afterEach, describe, expect, it } from "vitest";

import { groundFormSlots } from "@/lib/ai/form-full-remap";
import { EMPTY_FORM_STATE, prependFormState } from "@/lib/ai/form-state";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/**
 * D4 (QA, 25 Oct 2026): "Policy: Standards of Conduct, as you said" /
 * "Policy: Attendance, as you said" appeared when the manager never named a
 * policy. The form state wrote the extraction's heading ahead of the turn
 * ("Policy reference: …") and the policy reader took it for the manager's
 * words. The managers' wording is kept; the people are invented.
 */
const FLAG = "POLICY_AS_YOU_SAID_MANAGER_ONLY_ENABLED";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

function withState(
  question: string,
  policyHeading: string,
  policyPage: number | null = 12,
): string {
  return prependFormState(question, {
    ...EMPTY_FORM_STATE,
    employeeName: "test employee",
    policyHeading,
    policyPage,
  });
}

// conv_mvod8jw02vsk2py, turn 1.
const DEEP_CLEAN =
  "create a ca form for test employee because she didnt do deep clean assigned by 9-15-26";
const LATE = "Ava Pellmore was 20 minutes late for her shift on 10/20";

describe("POLICY_AS_YOU_SAID_MANAGER_ONLY_ENABLED", () => {
  it("off, the app's Policy reference line reads as stated (the reported failure)", () => {
    withFlag(false);
    const text = withState(DEEP_CLEAN, "Standards of Conduct");
    expect(text).toContain(
      "Policy reference: Standards of Conduct, JBA Policy Manual p.12.",
    );
    expect(caPolicyProposalLine(readCaPolicy(text))).toContain(
      "Standards of Conduct, as you said",
    );
    expect(
      caPolicyProposalLine(readCaPolicy(withState(LATE, "Attendance", null))),
    ).toContain("Attendance, as you said");
  });

  it('on, a policy the manager never named is never "as you said"', () => {
    withFlag(true);
    const conduct = caPolicyProposalLine(
      readCaPolicy(withState(DEEP_CLEAN, "Standards of Conduct")),
    );
    expect(conduct ?? "").not.toContain("as you said");
    expect(
      readCaPolicy(withState(DEEP_CLEAN, "Standards of Conduct")).stated,
    ).toBeNull();
    const attendance = caPolicyProposalLine(
      readCaPolicy(withState(LATE, "Attendance", null)),
    );
    expect(attendance ?? "").not.toContain("as you said");
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a policy the manager named stays "as you said"`, () => {
      withFlag(on);
      const said = withState(
        "write up Ava Pellmore for violating the standards of conduct policy on 10-20-26",
        "Standards of Conduct",
      );
      expect(caPolicyProposalLine(readCaPolicy(said))).toContain(
        "Standards of Conduct, as you said",
      );
      const attendance = withState(
        "Ava Pellmore broke the attendance policy, she was late 10/20",
        "Attendance",
        null,
      );
      expect(caPolicyProposalLine(readCaPolicy(attendance))).toContain(
        "Attendance, as you said",
      );
    });
  }
});

/*
 * THE REMAP'S POLICY LINE (Code 8 / QA, 26 Oct 2026): with
 * REMAP_INCIDENT_FIX off, `form-full-remap.ts` printed the model's section as
 * "**Policy:** <section>, as you said" for any section the model read.
 */
function remapReply(question: string, policySection: string): string {
  return groundFormSlots({
    raw: {
      templateKey: "dpoa",
      employeeName: "Ava Pellmore",
      observation: "Was late for the shift.",
      actionPlan: null,
      warningLevel: null,
      payrollDeduct: null,
      payrollAmount: null,
      jobTitle: null,
      store: null,
      policySection,
    },
    history: [],
    question,
    today: "2026-10-25",
    people: [],
  }).response.content;
}

/* How managers type (Pau, 26 Oct 2026): all lowercase, and sentence case with the name capitalised. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const lower = text
        .toLowerCase()
        .split("ava pellmore")
        .join("Ava Pellmore");
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    },
  ],
];

// QA, 26 Oct 2026: "tc, being late" names no policy.
const TC_LATE = "ca for ava pellmore tc, being late";
// A policy read from the account, never named: a missed meeting reads as Attendance.
const MISSED_MEETING =
  "ca for ava pellmore, she missed the monthly meeting on 10/20";

/** The turn as the remap reads it, behind the form state's own policy line. */
function behindPolicyLine(question: string, policyHeading: string): string {
  return prependFormState(question, { ...EMPTY_FORM_STATE, policyHeading });
}

const POLICY_AS_YOU_SAID = /\*\*Policy:\*\*[^\n]*as you said/;

describe.each(REGISTERS)(
  "POLICY_AS_YOU_SAID_MANAGER_ONLY_ENABLED in the managers' register: %s",
  (_register, as) => {
    it('off, the remap and the card say "as you said" for a policy nobody named (the reported failure)', () => {
      withFlag(false);
      expect(
        remapReply(behindPolicyLine(as(TC_LATE), "Attendance"), "Attendance"),
      ).toMatch(POLICY_AS_YOU_SAID);
      expect(remapReply(as(MISSED_MEETING), "Attendance")).toMatch(
        POLICY_AS_YOU_SAID,
      );
    });

    it('on, no policy the manager never named is "as you said" — remap or card', () => {
      withFlag(true);
      expect(
        remapReply(behindPolicyLine(as(TC_LATE), "Attendance"), "Attendance"),
      ).not.toMatch(POLICY_AS_YOU_SAID);
      expect(remapReply(as(MISSED_MEETING), "Attendance")).not.toMatch(
        POLICY_AS_YOU_SAID,
      );
      expect(
        caPolicyProposalLine(
          readCaPolicy(behindPolicyLine(as(TC_LATE), "Attendance")),
        ) ?? "",
      ).not.toContain("as you said");
      expect(
        caPolicyProposalLine(
          readCaPolicy(withState(as(DEEP_CLEAN), "Standards of Conduct")),
        ) ?? "",
      ).not.toContain("as you said");
    });

    for (const on of [false, true]) {
      it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a policy the manager named stays "as you said"`, () => {
        withFlag(on);
        const named = as("ca for ava pellmore she broke the attendance policy");
        expect(remapReply(named, "Attendance")).toContain(
          "**Policy:** Attendance, as you said",
        );
        expect(
          caPolicyProposalLine(
            readCaPolicy(behindPolicyLine(named, "Attendance")),
          ),
        ).toContain("Attendance, as you said");
      });
    }
  },
);

/*
 * PINNED FOR THE COORDINATOR (26 Oct 2026). With the flag on, `readCaPolicy`
 * no longer counts the app's own "Policy reference: …" line as stated, in
 * BOTH REMAP_INCIDENT_FIX branches (`managersWords` sits in ca-policy.ts,
 * which both read). So a turn whose only policy was that line reads no stated
 * policy, and the remap reply shows no Policy line at all for it.
 */
function remapReplyWithFix(question: string, fix: boolean): string {
  const before = process.env.REMAP_INCIDENT_FIX_ENABLED;
  if (fix) process.env.REMAP_INCIDENT_FIX_ENABLED = "true";
  else delete process.env.REMAP_INCIDENT_FIX_ENABLED;
  try {
    return remapReply(question, "Attendance");
  } finally {
    if (before === undefined) delete process.env.REMAP_INCIDENT_FIX_ENABLED;
    else process.env.REMAP_INCIDENT_FIX_ENABLED = before;
  }
}

describe.each(REGISTERS)("POLICY_AS_YOU_SAID_MANAGER_ONLY_ENABLED across REMAP_INCIDENT_FIX: %s", (_register, as) => {
  for (const fix of [false, true]) {
    it(`REMAP_INCIDENT_FIX ${fix ? "on" : "off"}: the app's own policy line is stated with the flag off, not with it on`, () => {
      const behind = behindPolicyLine(as(TC_LATE), "Attendance");
      withFlag(false);
      expect(readCaPolicy(behind).stated).toBe("attendance");
      expect(remapReplyWithFix(behind, fix)).toContain("**Policy:** Attendance, as you said");
      withFlag(true);
      expect(readCaPolicy(behind).stated).toBeNull();
      expect(remapReplyWithFix(behind, fix)).not.toMatch(/\*\*Policy:\*\*/);
    });
  }

  /*
   * KNOWN GAP, pinned (QA-6, 26 Oct 2026): "per the late open policy" is not
   * read as naming the Late Opening policy (`namedPolicy` knows "late opening
   * policy"), so with the flag on that manager loses ", as you said". Not
   * widened here: `namedPolicy` also feeds the REMAP_INCIDENT_FIX-on branch.
   */
  it('known gap: "per the late open policy" is not a named policy, so the flag drops "as you said"', () => {
    const said = as("ca for ava pellmore per the late open policy, late 10/20");
    process.env.LATE_OPEN_DATE_ENABLED = "true";
    try {
      withFlag(false);
      expect(remapReply(said, "Late Opening")).toContain("**Policy:** Late Opening, as you said");
      withFlag(true);
      expect(remapReply(said, "Late Opening")).toMatch(/\*\*Policy:\*\* Late Opening(?!, as you said)/);
    } finally {
      delete process.env.LATE_OPEN_DATE_ENABLED;
    }
  });
});
