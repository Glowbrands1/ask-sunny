import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RECORDS_NO_JUDGEMENT_RULE, renderFormRecordsBlock, withoutRecordJudgement } from "./chat-form-records";

/** FORM_RECORDS_NO_JUDGEMENT_ENABLED (QA's live test in the sibling app, 8 Nov 2026; the judgement sentences as seen, the person invented). */

const LISTED = [
  "Yes — Marnie Holloway has 3 forms on file:",
  "- Corrective Action Form — 10/28/2026 — finalized",
  "- Corrective Action Form — 10/21/2026 — finalized",
  "- Coaching Form — 10/16/2026 — finalized",
];
const REPLY = [
  ...LISTED,
  "",
  "That's a notable number of Corrective Actions in under two weeks for one person. It's worth reviewing these before deciding what comes next.",
  "You can open any of these in Forms → Form Monitoring.",
].join("\n");

afterEach(() => vi.unstubAllEnvs());

describe("withoutRecordJudgement", () => {
  it("drops the judgement and keeps every listed form and the Register line", () => {
    const out = withoutRecordJudgement(REPLY);
    for (const line of LISTED) expect(out).toContain(line);
    expect(out).toContain("You can open any of these in Forms → Form Monitoring.");
    expect(out).not.toMatch(/notable number|worth reviewing|what comes next/i);
  });

  it("leaves a plain list alone", () => {
    const plain = [...LISTED, "", "You can open any of these in Forms → Form Monitoring."].join("\n");
    expect(withoutRecordJudgement(plain)).toBe(plain);
  });
});

describe("the Forms Register block", () => {
  const block = () =>
    renderFormRecordsBlock({ visibility: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } as never, words: [], matches: null, recent: [], today: "2026-11-08" });

  it("carries the rule only with the flag on", () => {
    expect(block()).not.toContain(RECORDS_NO_JUDGEMENT_RULE);
    vi.stubEnv("FORM_RECORDS_NO_JUDGEMENT_ENABLED", "1");
    expect(block()).toContain(RECORDS_NO_JUDGEMENT_RULE);
  });
});
