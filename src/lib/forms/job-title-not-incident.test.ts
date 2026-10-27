import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { managerWordsObservation, notesHoldAccount } from "./draft-never-blank";

/*
 * JOB_TITLE_NOT_INCIDENT_ENABLED. Manager, 26 Oct 2026 (Ask Sunny production,
 * the Standards of Conduct meeting complaint), word for word, the name
 * invented: no incident was given, and the draft was filed "Observed: Salon
 * Director." — the job title as what happened. Production flags on.
 */
const CASES = [
  ["lowercase", ["create corrective action form for mara quill, salon director", "mara quill, salon director"]],
  ["Sentence case", ["Create corrective action form for Mara Quill, Salon Director", "Mara Quill, Salon Director"]],
] as const;

const FLAG = "JOB_TITLE_NOT_INCIDENT_ENABLED";
const LIVE = ["DRAFT_NEVER_BLANK_ENABLED", "PRIOR_SENTENCE_FIX_ENABLED", "REQUEST_LINE_ACCOUNT_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED"];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...LIVE, FLAG]) saved.set(name, process.env[name]);
  for (const name of LIVE) process.env[name] = "true";
  delete process.env[FLAG];
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe(`${FLAG} on`, () => {
  it.each(CASES)("%s: no Observation is written from the job title", (_casing, turns) => {
    process.env[FLAG] = "true";
    const notes = turns.join("\n\n");
    expect(managerWordsObservation(notes, "Mara Quill")).toBeNull();
    expect(notesHoldAccount(notes, "Mara Quill")).toBe(false);
  });

  it.each(["tan consultant", "Tanning Consultant", "an ASD", "SDIT"])("%s alone is a title, not an issue", (title) => {
    process.env[FLAG] = "true";
    expect(managerWordsObservation(`create a ca for mara quill, ${title}`, "Mara Quill")).toBeNull();
  });

  it("a real issue after the name is still written", () => {
    process.env[FLAG] = "true";
    expect(managerWordsObservation("create a ca for mara quill for cash handling", "Mara Quill")).toBe("Observed:\nCash handling.");
  });
});

describe(`${FLAG} off: as main`, () => {
  it.each(CASES)("%s: the job title is filed as the Observation", (_casing, turns) => {
    expect(managerWordsObservation(turns.join("\n\n"), "Mara Quill")).toMatch(/^Observed:\nSalon director\.$/i);
  });

  it("the flag reads off by default", async () => {
    const { jobTitleNotIncidentEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(jobTitleNotIncidentEnabled()).toBe(false);
  });
});
