import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChatFormProposal } from "@/types";

import { withoutNoAccountAppPolicy } from "./no-account-policy-line";
import type { AskResponse } from "./types";

/**
 * NO_ACCOUNT_NO_APP_POLICY_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026): "ca for <A> not late" asked what
 * happened and also said "**Policy:** Attendance — read from this request". The person is invented.
 */
const CARD = { proposalId: "p-1", templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Rowan Kestrel" } as unknown as ChatFormProposal;
const ASK =
  "**You haven't told me what happened yet**, so I can't cite the policy manual — the draft will come back without the policy section and page.";
const APP_READ = "**Policy:** Attendance — read from this request. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies.";
const AS_YOU_SAID = "**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.";

function reply(...lines: string[]): AskResponse {
  return { content: lines.join("\n\n"), citations: [], formProposal: CARD } as unknown as AskResponse;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withoutNoAccountAppPolicy", () => {
  it("off: the reply is as built", () => {
    const built = reply("I'll draft a **Corrective Action Form** for **Rowan Kestrel**.", ASK, APP_READ);
    expect(withoutNoAccountAppPolicy(built)).toBe(built);
  });

  describe("on", () => {
    it("a card that asks what happened has no Policy line read from the request", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const out = withoutNoAccountAppPolicy(reply("I'll draft a **Corrective Action Form** for **Rowan Kestrel**.", ASK, APP_READ, "Create the draft here when you're ready."));
      expect(out.content).not.toMatch(/read from this request/);
      expect(out.content).toContain(ASK);
      expect(out.content).toContain("Create the draft here when you're ready.");
      expect(out.content).not.toMatch(/\n{3,}/);
    });

    it("nor a citation line, nor citations, and the Action Plan names no policy", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = {
        ...reply(
          "I'll draft a **Corrective Action Form** for **Rowan Kestrel**.",
          ASK,
          APP_READ,
          "Attendance Policy, JBA Policy Manual p.14",
          "**Action Plan:** Management will review the Attendance policy with Rowan. Future policy violations may result in additional corrective action up to and including termination of employment.",
        ),
        citations: [{ excerpt: "Attendance Policy. …" }],
      } as unknown as AskResponse;
      const out = withoutNoAccountAppPolicy(built);
      expect(out.content).not.toMatch(/JBA Policy Manual/);
      expect(out.content).toContain("**Action Plan:** Management will review the applicable company policy with Rowan.");
      expect(out.citations).toEqual([]);
    });

    it("a citation inside a sentence is not a citation-only line", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const out = withoutNoAccountAppPolicy(reply(ASK, "I'll quote Attendance Policy, JBA Policy Manual p.14 once you tell me what happened, if it applies."));
      expect(out.content).toContain("once you tell me what happened");
    });

    it("a card with an account keeps the app's reading", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = reply("I'll draft a **Corrective Action Form** for **Rowan Kestrel**.", APP_READ);
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });

    it("a policy the manager named stays beside the ask, with its citation and plan", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = reply(
        "I'll draft a **Corrective Action Form** for **Rowan Kestrel**.",
        ASK,
        AS_YOU_SAID,
        "Attendance Policy, JBA Policy Manual p.14",
        "**Action Plan:** Management will review the Attendance policy with Rowan.",
      );
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });

    it("a Coaching Form card is left alone", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = { ...reply(ASK, APP_READ), formProposal: { ...CARD, templateKey: "coaching", templateName: "Coaching Form" } } as AskResponse;
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });
  });
});
