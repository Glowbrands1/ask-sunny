import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "… FOR <FIRST> <LAST> BC SHE DIDNT …": "BC" IS "BECAUSE", NEVER PART OF THE NAME (October rebuild 2, 10 Nov 2026)
 * ============================================================================
 *
 * conv_mvofjlco271mr0t (25 Oct 2026; reported with #250): "crete a ca for <first> <last> bc she didnt do the deep clean
 * i assignd by 9-15". QA's October triage (docs/parity-log/oct-pr-triage.md, 10 Nov 2026), with production's flags: the
 * card reads "<First> <Last> Bc" ("bc" = because, read as part of the name); the next turn corrects it.
 *
 * The manager's words, the person invented (Orla Penhallow, on no directory but this pack's).
 */
const ORLA: DirectoryRow = {
  id: "e-bc-orla-penhallow",
  firstName: "Orla",
  lastName: "Penhallow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const TURN = "crete a ca for orla penhallow bc she didnt do the deep clean i assignd by 9-15";
const FLAG = "BC_NOT_A_NAME_ENABLED";
const REPORT = 'conv_mvofjlco271mr0t (25 Oct 2026, with #250; the October triage, 10 Nov 2026): "crete a ca for <first> <last> bc she didnt do the deep clean i assignd by 9-15"';

function start(t: ReplayContext, onRoster: boolean) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory(onRoster ? [...STAFF, ORLA] : [...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const casings = (s: string) =>
  [
    ["lower", s],
    ["sentence", s[0]!.toUpperCase() + s.slice(1).replace("orla penhallow", "Orla Penhallow")],
    ["caps", s.toUpperCase()],
  ] as const;

export const NOV10_BC_NOT_A_NAME_CASES: ReplayCase[] = ([true, false] as const).flatMap((onRoster) =>
  casings(TURN).map(([casing, text]) => ({
    id: `nov10-bc-not-a-name-${onRoster ? "on" : "off"}-roster-${casing}`,
    title: `"${text}" (${onRoster ? "on" : "off"} roster) — the card's employee is Orla Penhallow, never "… Bc"`,
    report: `${REPORT}; ${onRoster ? "on" : "off"} roster, ${casing}`,
    status: { open: "\"bc\" (because) is read as part of the name: \"Orla Penhallow Bc\"" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t, onRoster);
      const reply = await thread.say(text);
      // The name as the reply shows it ("for **Orla Penhallow**"); the Observation quoting the whole message is #167's.
      expect(reply.content, `"bc" read as part of the name:\n${reply.content}`).not.toMatch(/\*\*[^*\n]*penhallow\s+bc\*\*/i);
      const employee = thread.proposal?.employeeName ?? "";
      expect(employee, `"bc" on the card's employee:\n${reply.content}`).not.toMatch(/\bbc\b/i);
      if (thread.proposal?.employeeName) expect(employee).toMatch(/^orla penhallow$/i);
    },
  })),
);
