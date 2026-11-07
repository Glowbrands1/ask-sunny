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

    it("a card with an account keeps the app's reading", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = reply("I'll draft a **Corrective Action Form** for **Rowan Kestrel**.", APP_READ);
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });

    it("a policy the manager named stays beside the ask", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = reply("I'll draft a **Corrective Action Form** for **Rowan Kestrel**.", ASK, AS_YOU_SAID);
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });

    it("a Coaching Form card is left alone", () => {
      vi.stubEnv("NO_ACCOUNT_NO_APP_POLICY_ENABLED", "true");
      const built = { ...reply(ASK, APP_READ), formProposal: { ...CARD, templateKey: "coaching", templateName: "Coaching Form" } } as AskResponse;
      expect(withoutNoAccountAppPolicy(built)).toBe(built);
    });
  });
});
