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

/** chat_traces conv_mvmj6v1t250hfij, in order. */
const TURNS = [
  "CA for Test Employee at Kearney, out of dress code 10/11",
  "verbal, prior = manual ack 9/01, no payroll",
  "Use Kearney as the location",
] as const;

const TODAY = "2026-10-24";

function replay(options?: { repeatCurrent?: boolean }) {
  let history: { role: string; content: string }[] = [];
  let saved: FormRemapSlots | null = null;
  const steps: ReturnType<typeof groundFormSlots>[] = [];
  for (const question of TURNS) {
    const step = groundFormSlots({
      raw: {
        templateKey: "coaching",
        employeeName: null,
        observation: "invented unicorn incident",
        store: "Grand Island",
        warningLevel: null,
        payrollDeduct: null,
      },
      history: options?.repeatCurrent ? [...history, { role: "user", content: question }] : history,
      question,
      today: TODAY,
      people: [],
      saved,
    });
    steps.push(step);
    history = [...history, { role: "user", content: question }];
    saved = step.slots;
  }
  return steps;
}

function cardText(proposal: NonNullable<ReturnType<typeof groundFormSlots>["response"]["formProposal"]>): string {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    content: "Draft",
    createdAt: "2026-10-24T15:06:00Z",
    mode: "standard",
    coverage: "not_applicable",
    citations: [],
    recommendedVideoIds: [],
    formProposal: proposal,
  };
  render(<MessageBubble message={message} onSuggestion={() => {}} />);
  return document.querySelector("dl")?.textContent ?? "";
}

function count(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

describe("conv_mvmj6v1t250hfij", () => {
  it("replays the turns onto the corrective action card", () => {
    const steps = replay();
    for (const step of steps) {
      expect(step.slots.incidentDateIso).toBe("2026-10-11");
      expect(step.slots.incidentDateIso).not.toBe("2026-09-01");
    }
    const last = steps.at(-1)!;
    const card = last.response.formProposal!;
    expect(last.slots.templateKey).toBe("dpoa");
    expect(last.slots.employeeName).toBe("Test Employee");
    expect(last.slots.store).toMatch(/Kearney/);
    expect(last.slots.locationId).toBe("loc-0309");
    expect(last.slots.warningLevel).toBe("verbal");
    expect(last.slots.priorActions).toBe("manual acknowledgement 9/01");
    expect(last.slots.payrollDeduct).toBe("no");
    expect(last.slots.payrollAmount).toBeNull();
    expect(last.slots.observation).toMatch(/dress code/);
    expect(last.response.content).toContain("**Salon:** NE Kearney");
    expect(last.response.content).not.toMatch(
      /Which date should go on the form\?|Which salon\?|What happened\?|Verbal or written\?|Is payroll deduct applicable\?|Who is this for\?/,
    );

    const shown = cardText(card);
    expect(screen.getByText("Corrective Action Form")).toBeTruthy();
    expect(screen.queryByText("Coaching Form")).toBeNull();
    expect(shown).toContain("Test Employee");
    expect(shown).toContain("Kearney");
    expect(shown).toContain("2026-10-11");
    expect(shown).not.toContain("2026-09-01");
    expect(shown).toContain("Verbal Warning");
    expect(shown).toContain("manual acknowledgement 9/01");
    expect(shown).toContain("No");
    expect(shown).toContain("dress code");
  });

  it("renders the prior action once after every turn, including when this turn is already in the history", () => {
    for (const repeatCurrent of [false, true]) {
      for (const [index, step] of replay({ repeatCurrent }).entries()) {
        cleanup();
        const message: ChatMessage = {
          id: `m-${index}`,
          role: "assistant",
          content: step.response.content,
          createdAt: "2026-10-24T15:06:00Z",
          mode: "standard",
          coverage: "not_applicable",
          citations: [],
          recommendedVideoIds: [],
          formProposal: step.response.formProposal,
        };
        const view = render(<MessageBubble message={message} onSuggestion={() => {}} />);
        const shown = view.container.textContent ?? "";
        const where = `repeatCurrent=${repeatCurrent} turn ${index + 1}`;
        const expected = index === 0 ? 0 : 1;
        expect(count(shown, "manual acknowledgement 9/01"), where).toBe(expected);
        expect(count(document.querySelector("dl")?.textContent ?? "", "manual acknowledgement 9/01"), where).toBe(expected);
        expect(count(shown, "Prior action"), where).toBe(expected);
        if (index > 0) expect(step.slots.priorActions).toBe("manual acknowledgement 9/01");
      }
    }
  });
});
