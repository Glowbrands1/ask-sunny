import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A CLEANING DUTY BESIDE A SECOND DESCRIBED OFFENSE TICKS BOTH (OTHER_POLICY_AGREES_ENABLED; QA's ruling (b), 14 Nov 2026)
 * ============================================================================
 *
 * The sibling app's gate probes on its port of this flag (Gate-Bubbles-5, 14 Nov 2026), checked here on production's
 * flags at QA's request: "make a ca for <A>, she was on her phone and did not do the 10 minute sanitation" saved Other
 * alone while Direct policy quoted the Cell Phone/Smart Watch Policy p.19; "…she was late on 11/3/26 and did not do the
 * sanitation" saved Other alone and dropped Attendance. QA: tick both, with the card, Direct policy and the plan on the
 * described offense; a cleaning duty that is the only offense stays Other alone (Pau's rule). The gate's words; the
 * person is invented (on no directory).
 */
const PIA: DirectoryRow = { id: "e-pia-obd", firstName: "Pia", lastName: "Wexcombe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const FLAGS = ["OTHER_POLICY_AGREES_ENABLED", "OTHER_NOT_A_POLICY_NAME_ENABLED"];
const flagsOn = () => FLAGS.every((flag) => process.env[flag] === "true");
const REPORT = "The sibling app's gate probes (Gate-Bubbles-5, 14 Nov 2026), QA's ruling (b): a cleaning duty beside a described offense ticks both";

const BESIDE: [string, string, string, RegExp, RegExp][] = [
  [
    "phone",
    "make a ca for Pia Wexcombe, she was on her phone and did not do the 10 minute sanitation",
    "Observed:\nPia Wexcombe was on the phone and did not do the 10 minute sanitation.",
    /cell phone/i,
    /standards_of_conduct/,
  ],
  [
    "late",
    "make a ca for Pia Wexcombe, she was late on 11/3/26 and did not do the sanitation",
    "Observed:\nPia Wexcombe was late on 11/3/26 and did not do the sanitation.",
    /attendance/i,
    /tardiness|attendance/,
  ],
];

export const NOV14_OTHER_BESIDE_DESCRIBED_CASES: ReplayCase[] = BESIDE.map(([key, ask, observation, policy, box]): ReplayCase => ({
  id: `nov14-other-beside-described-${key}`,
  title: `"${ask}": the described offense keeps its card line, box, Policy Violated, Direct policy and plan; Other is ticked beside it`,
  report: REPORT,
  status: { open: "the draft saves Other alone (and, for the phone, Direct policy quotes the Cell Phone section the box no longer names)" },
  fixFlags: ["OTHER_BESIDE_DESCRIBED_ENABLED"],
  async run(t) {
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    t.directory([...STAFF, PIA]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const card = await thread.say(ask);
    t.draftWrites({ observation });
    const id = await thread.create();
    const values = t.values(id);
    const offense = t.checked(id).offense_type ?? [];
    const where = JSON.stringify({ offense, violated: values.policy_violated, lang: (values.policy_language ?? "").slice(0, 60), plan: (values.action_plan ?? "").slice(0, 90) });
    expect(values.action_plan ?? "", `the plan names Other as a policy ${where}`).not.toMatch(/\bthe Other polic/i);
    if (!flagsOn()) return; // with the flags off the sanitation is not read at all
    expect(card.content, `the card's policy is not the described one:\n${card.content}`).toMatch(new RegExp(String.raw`\*\*Policy:\*\*[^\n]*${policy.source}`, "i"));
    expect(card.content, `the card does not say the cleaning duty is recorded under Other:\n${card.content}`).toMatch(/recorded under \*\*Other\*\*/);
    expect(offense.some((k) => box.test(k)), `the described offense lost its box ${where}`).toBe(true);
    expect(offense, `Other is not ticked beside the described offense ${where}`).toContain("other");
    expect(values.policy_violated ?? "", `Policy Violated lost the described policy ${where}`).toMatch(policy);
      // Gate-Sunny-3's #971 probe (14 Nov 2026): Policy Violated names Other beside the described policy.
      expect(values.policy_violated ?? "", `Policy Violated lost Other ${where}`).toMatch(/(?:^|,\s*)Other$/);
    expect(values.policy_language ?? "", `Direct policy is not the described section ${where}`).not.toBe("");
    expect(values.action_plan ?? "", `the plan does not follow the described offense ${where}`).toMatch(policy);
  },
}));

/* Guard (QA, 14 Nov 2026): a cleaning duty that is the only offense stays Other alone with the new flag on (Pau's rule). */
export const NOV14_OTHER_BESIDE_DESCRIBED_GUARDS: ReplayCase[] = [
  {
    id: "nov14-other-beside-described-cleaning-only-stays-other",
    title: "\"please make a ca for Pia Wexcombe for not doing th e10 minute sanitaion\": the cleaning duty alone stays Other alone",
    report: `${REPORT} (the guard: Pau's rule for a cleaning duty alone)`,
    status: "fixed",
    fixFlags: ["OTHER_BESIDE_DESCRIBED_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
      t.directory([...STAFF, PIA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say("please make a ca for Pia Wexcombe for not doing th e10 minute sanitaion");
      t.draftWrites({ observation: "Observed:\nPia Wexcombe did not do the 10 minute sanitation." });
      const id = await thread.create();
      if (!flagsOn()) return;
      expect(card.content, `the card does not say Other:\n${card.content}`).toMatch(/\*\*Policy:\*\* Other/);
      expect(card.content, "the card says Other beside another offense").not.toMatch(/recorded under \*\*Other\*\* on the form too/);
      expect(t.checked(id).offense_type ?? [], "a cleaning duty alone is not Other alone").toEqual(["other"]);
      expect(t.values(id).policy_violated ?? "").toMatch(/^Other$/);
    },
  },
];
