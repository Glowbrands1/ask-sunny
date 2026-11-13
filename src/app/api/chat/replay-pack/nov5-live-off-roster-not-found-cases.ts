import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * QA'S LIVE RUN in the sibling app (5 Nov 2026, real model, the flip flags +
 * GLOSSARY): AN OFF-ROSTER FULL NAME IS NEVER JUST ASKED FOR AGAIN
 * ============================================================================
 *
 * mgr-1-off-roster-name: "I need a corrective action verbal for <name>. This is
 * for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."
 * (the name on no roster; a roster near-name exists). The card had no employee
 * and the reply ended "Who is this form for? Tell me the employee's full
 * name." — it never said the typed name was not found, so a manager retypes
 * it: the loop of the R3 rollback. Here GROUNDED_ENTITIES_ENABLED is on in
 * production, and on this path the note is still not written. The person and
 * the near-name are invented.
 */

const near: DirectoryRow = {
  id: "e-leofric-arkwright",
  firstName: "Leofric",
  lastName: "Arkwright",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const FLIP = ["CHAT_GLOSSARY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED", "CA_SALES_POLICY_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "ROSTER_NAME_IN_CANDIDATE_ENABLED", "TITLE_OF_THE_EMPLOYEE_ENABLED"];
const TEXT = "I need a corrective action verbal for Leofric Arkwell. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";
const REPORT = "QA's LIVE=1 run in the sibling app, 5 Nov 2026 (the flip flags): mgr-1-off-roster-name, an empty card and \"Who is this form for?\" with no not-found note; checked here with this app's flip flags";

function withFlip(run: ReplayCase["run"]): ReplayCase["run"] {
  return async (t) => {
    for (const flag of FLIP) vi.stubEnv(flag, "true");
    try {
      await run(t);
    } finally {
      vi.unstubAllEnvs();
    }
  };
}

function check(mode: "code" | "models"): ReplayCase["run"] {
  return withFlip(async (t) => {
    vi.setSystemTime(new Date("2026-11-04T16:00:00Z"));
    t.directory([...STAFF, near]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(TEXT, mode === "models" ? { employeeName: "Leofric Arkwell" } : {});
    expect(thread.proposal?.employeeName ?? null, `a name on no roster is the employee:\n${reply.content}`).toBeNull();
    // Changed on purpose (10 Nov 2026, QA's roster-set ruling): with the name set on, a salon manager's not-found line is OFF_ROSTER_ASK's "I can't find **<name>** on your roster — …" (round 12's live wording), not "I couldn't find **<name>** in the Woven roster".
    expect(reply.content, `the typed name is never said to be not found:\n${reply.content}`).toMatch(/I couldn't find \*\*Leofric Arkwell\*\* in the Woven roster|I can't find \*\*Leofric Arkwell\*\* on your roster/);
    // Changed on purpose (QA, 7 Nov 2026; as the sibling app's #516, finding C): with OFF_ROSTER_CONFIRM the off-roster offer ("reply **use <name>**") is the question about the person, instead of "Who is this form for?".
    expect(reply.content, `does not ask who:\n${reply.content}`).toMatch(/Who is this (?:\*\*[^*]+\*\* |form )?for\?|Is this for \*\*|reply \*\*use [^*]+\*\* and I'll put that name on the form/);
    // The name is the not-found note's only: never the employee anywhere else.
    const elsewhere = reply.content.split("\n").filter((line) => !/I couldn't find \*\*|I can't find \*\*[^*]+\*\* on your roster/.test(line)).join("\n");
    expect(elsewhere, `the name is presented as the employee:\n${reply.content}`).not.toMatch(/Leofric|Arkwell/);
  });
}

export const NOV5_LIVE_OFF_ROSTER_NOT_FOUND_CASES: ReplayCase[] = (["code", "models"] as const).map((mode) => ({
  id: `nov5-live-off-roster-not-found-${mode}`,
  title: `QA live mgr-1-off-roster-name (${mode === "code" ? "code only" : "models read the name"}): "I need a corrective action verbal for <name>. This is for Under Performance …", on no roster: "I couldn't find **<name>** in the Woven roster", then asks who; never the employee`,
  report: REPORT,
  status: "fixed",
  run: check(mode),
}));
