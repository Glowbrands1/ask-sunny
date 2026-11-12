import { afterEach, describe, expect, it, vi } from "vitest";

import { nameCorrectionQuestion, nameNotCorrectedReply } from "./name-correction-words";

// QA's live CA chat (4 Nov 2026): "fix her last name, it is Doe-Smith" (invented name).
const TYPED = "fix her last name, it is Doe-Smith";

describe("NAME_LINE_COMMA_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the comma keeps the turn from reading as a name correction", () => {
    vi.stubEnv("NAME_CORRECTION_WORDS_ENABLED", "true");
    expect(nameCorrectionQuestion(TYPED, "Jane Doe")).not.toBe("change her name to Jane Doe-Smith");
    expect(nameNotCorrectedReply({ templateName: "Corrective Action Form", employeeName: "Jane Doe" }, "change her name to Jane Doe-Smith").content).not.toContain("?");
  });

  it("on: it reads as \"change her name to Jane Doe-Smith\", and the reply asks to confirm it", () => {
    vi.stubEnv("NAME_CORRECTION_WORDS_ENABLED", "true");
    vi.stubEnv("NAME_LINE_COMMA_ENABLED", "true");
    const question = nameCorrectionQuestion(TYPED, "Jane Doe");
    expect(question).toBe("change her name to Jane Doe-Smith");
    expect(nameCorrectionQuestion("fix her last name: Doe-Smith", "Jane Doe")).toBe("change her name to Jane Doe-Smith");
    const reply = nameNotCorrectedReply({ templateName: "Corrective Action Form", employeeName: "Jane Doe" }, question!);
    expect(reply.content).toContain("Should it read **Jane Doe-Smith**?");
  });
});
