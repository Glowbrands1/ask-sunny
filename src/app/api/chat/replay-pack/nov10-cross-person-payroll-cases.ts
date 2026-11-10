import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * <B>'S CARD NEVER CARRIES <A>'S PAYROLL ANSWER (#166, rebuilt 10 Nov 2026)
 * ============================================================================
 *
 * conv_mvoftzhs29se8nb (25 Oct 2026; Ask-bubbles#166 / ask-sunny#236, never merged; the conversation is the sibling app's, its mechanism is shared). The October triage
 * (docs/parity-log/oct-pr-triage.md, 10 Nov 2026), with production's flags: request 1 for <A>, then "no payroll
 * deduct", then "create a verbal corrective action form for <B>. on 10-20-26 <B> was talking on her cell phone for
 * over 30 minutes" — <B>'s card says "Is payroll deduct applicable? **No**", never said for <B>.
 *
 * The chat word for word, with the triage's invented names: Wren Calloway is <A>, Remy Calder is <B>.
 */
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});
const WREN = person("e-xpayroll-wren-calloway", "Wren", "Calloway");

const TURN_1 = "create verbal CA for wren calloway, she was late on 10-19-26, previous coaching was jba policy manual 1-1-26";
const TURN_2 = "no payroll deduct";
const TURN_3 = "create a verbal corrective action form for remy calder. on 10-20-26 remy calder was talking on her cell phone for over 30 minutes";

const REPORT = 'conv_mvoftzhs29se8nb (25 Oct 2026, #166; the October triage, 10 Nov 2026): after <A>\'s CA and "no payroll deduct", <B>\'s request';
const OPEN = "<B>'s card says payroll deduct is No, said only for <A>";

const payroll = (thread: { proposal: unknown }) => (thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct ?? null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  t.directory([...STAFF.filter((row) => !(row.firstName === "Wren" && row.lastName === "Calloway")), WREN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const casings = (s: string) =>
  [
    ["lower", s.toLowerCase()],
    ["sentence", s[0]!.toUpperCase() + s.slice(1)],
    ["caps", s.toUpperCase()],
  ] as const;

export const NOV10_CROSS_PERSON_PAYROLL_CASES: ReplayCase[] = casings(TURN_3).map(([casing, turn3]) => ({
  id: `nov10-cross-person-payroll-${casing}`,
  title: `after Wren Calloway's CA and "no payroll deduct", "${turn3}" — Remy Calder's card has no payroll answer`,
  report: `${REPORT}; ${casing}`,
  status: { open: OPEN },
  fixFlags: ["CROSS_PERSON_OWN_TURNS_ENABLED"],
  async run(t) {
    const thread = start(t);
    await thread.say(TURN_1);
    expect(thread.proposal, "turn 1 made no CA card for Wren").toMatchObject({ templateKey: "dpoa", employeeName: "Wren Calloway" });
    await thread.say(TURN_2);
    expect(payroll(thread), "Wren's payroll answer was not read").toBe("no");
    const reply = await thread.say(turn3);
    expect(thread.proposal, `no card for Remy:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
    expect(payroll(thread), `Remy's card carries Wren's payroll answer:\n${reply.content}`).toBeNull();
    expect(reply.content, "Remy's card says payroll No").not.toMatch(/payroll deduct(?:ion)?[^\n]*\*\*no\*\*/i);
  },
}));
