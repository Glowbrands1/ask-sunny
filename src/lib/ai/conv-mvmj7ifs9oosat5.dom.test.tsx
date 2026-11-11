// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "@/features/chat/message-bubble";
import type { ChatMessage } from "@/types";

import { groundFormSlots, type FormRemapSlots } from "./form-full-remap";

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

/** chat_traces conv_mvmj7ifs9oosat5, in order. */
const TURNS = [
  "Test Employee at Grand Island out of dress code 3 shifts, coached on 2nd",
  "Create a Coaching Form",
  "Yes",
] as const;

const TODAY = "2026-10-24";

function replay() {
  let history: { role: string; content: string }[] = [];
  let saved: FormRemapSlots | null = null;
  let last: ReturnType<typeof groundFormSlots> | null = null;
  for (const question of TURNS) {
    last = groundFormSlots({
      raw: {
        templateKey: "dpoa",
        employeeName: null,
        observation: "invented unicorn incident",
        store: "Kearney",
        warningLevel: "verbal",
        payrollDeduct: "yes",
      },
      history,
      question,
      today: TODAY,
      people: [],
      saved,
    });
    history = [...history, { role: "user", content: question }];
    saved = last.slots;
  }
  if (!last) throw new Error("no turns");
  return last;
}

describe("conv_mvmj7ifs9oosat5", () => {
  it("replays the turns onto the coaching card", () => {
    const { slots, response } = replay();
    const card = response.formProposal!;
    expect(slots.templateKey).toBe("coaching");
    expect(slots.employeeName).toBe("Test Employee");
    expect(slots.store).toMatch(/Grand Island/);
    expect(slots.locationId).toBe("loc-0307");
    expect(slots.observation).toBe("dress code, 3 shifts");
    expect(slots.priorActions).toBe("coached on 2nd");
    expect(slots.warningLevel).toBeNull();
    expect(slots.payrollDeduct).toBeNull();
    expect(response.content).not.toMatch(/Kearney|Lawrence/);
    expect(response.content).not.toMatch(/Who is this for\?|Which salon\?|What happened\?/);

    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Draft",
      createdAt: "2026-10-24T15:06:00Z",
      mode: "standard",
      coverage: "not_applicable",
      citations: [],
      recommendedVideoIds: [],
      formProposal: card,
    };
    render(<MessageBubble message={message} onSuggestion={() => {}} />);
    const shown = document.querySelector("dl")?.textContent ?? "";
    expect(screen.getByText("Coaching Form")).toBeTruthy();
    expect(screen.queryByText("Corrective Action Form")).toBeNull();
    expect(shown).toContain("Test Employee");
    expect(shown).toContain("Grand Island");
    expect(shown).toContain("dress code, 3 shifts");
    expect(shown).toContain("coached on 2nd");
    expect(shown).not.toContain("Verbal Warning");
    expect(shown).not.toMatch(/Kearney|Lawrence/);
  });
});
