import { afterEach, describe, expect, it, vi } from "vitest";

import { replyMatchesCard } from "@/lib/ai/reply-matches-card";
import type { AskResponse } from "@/lib/ai/types";

import { readCaPolicy } from "./ca-policy";

/** CONDUCT_INCIDENT_CITES_PAGE_ENABLED (QA's live tester, 8 Nov 2026; the managers' Woven wordings, word for word). */

const COURSES = "Please create another corrective action from marnie holloway. This would be a verbal due to not completing her woven courses by the deadline";
const CARD = [
  "**Policy:** this reads as **Standards of Conduct** — a required deadline that was missed. I'll check it against the current policy manual and quote that section on the draft.",
  "",
  "Standards of Conduct Policy, JBA Policy Manual p.12",
  "",
  "Attendance Policy, JBA Policy Manual p.14",
].join("\n");

function card(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", formProposal: { templateKey: "dpoa", employeeName: "Marnie Holloway" } } as unknown as AskResponse;
}

afterEach(() => vi.unstubAllEnvs());

describe("not completing Woven courses", () => {
  it("reads as no conduct topic with the flag off (as before), unfinished work with it on", () => {
    expect(readCaPolicy(COURSES).suggestion).toBeNull();
    vi.stubEnv("CONDUCT_INCIDENT_CITES_PAGE_ENABLED", "1");
    expect(readCaPolicy(COURSES)).toMatchObject({ topics: ["task"], suggestion: "standards_of_conduct", source: "incident" });
  });

  it("a named policy still wins", () => {
    vi.stubEnv("CONDUCT_INCIDENT_CITES_PAGE_ENABLED", "1");
    expect(readCaPolicy("a ca for violating the attendance policy, she was not completing her courses").stated).toBe("attendance");
  });
});

describe("the card's one policy", () => {
  it("drops its own Standards of Conduct line with the flag off (as before), keeps it with the flag on", () => {
    expect(replyMatchesCard(card(CARD), []).content).not.toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
    vi.stubEnv("CONDUCT_INCIDENT_CITES_PAGE_ENABLED", "1");
    const kept = replyMatchesCard(card(CARD), []).content;
    expect(kept).toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
    expect(kept, "another policy's line still goes").not.toContain("Attendance Policy, JBA Policy Manual p.14");
  });
});
