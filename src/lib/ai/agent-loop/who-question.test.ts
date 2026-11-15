import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChatMessage } from "@/types";

import { answersWhoQuestion } from "./run";

/** Fix batch item 6 (c124, c165): the reply before this message asked who the form is for, in the app's own words. */
const after = (...turns: [ChatMessage["role"], string][]) => turns.map(([role, content]) => ({ role, content }) as ChatMessage);

describe("answersWhoQuestion (item 6)", () => {
  it("reads the rules book's question and propose_form's ask_exactly", () => {
    expect(answersWhoQuestion(after(["user", "I need a coaching form"], ["assistant", "Who is this Coaching Form for?"]))).toBe(true);
    expect(answersWhoQuestion(after(["user", "a CA for animals"], ["assistant", "Corrective Action citing **Animals in the Workplace** (p.12). Who is it for?"]))).toBe(true);
  });

  it("only the latest reply counts, and other questions are not it", () => {
    expect(answersWhoQuestion(after(["assistant", "Who is this Coaching Form for?"], ["user", "rowan"], ["assistant", "Here's the Coaching Form for **Rowan Kestrel**."]))).toBe(false);
    expect(answersWhoQuestion(after(["assistant", "What happened?"]))).toBe(false);
    expect(answersWhoQuestion([])).toBe(false);
  });
});
