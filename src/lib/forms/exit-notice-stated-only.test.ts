import { afterEach, describe, expect, it, vi } from "vitest";

import { readExitFacts } from "./exit-facts";

/* EXIT_NOTICE_STATED_ONLY_ENABLED (ported from the sibling app: QA's Bubbles 17j live test, 12 Nov 2026). The tester's wording; invented person. */
const TODAY = "2026-11-12";
const SAID = "exit form for Tamsin Okafor, she resigned 11/8";

afterEach(() => vi.unstubAllEnvs());

describe("EXIT_NOTICE_STATED_ONLY_ENABLED", () => {
  it("off: as before — the resignation date also dates the notice", () => {
    vi.stubEnv("EXIT_NOTICE_STATED_ONLY_ENABLED", "false");
    const facts = readExitFacts(SAID, TODAY);
    expect(facts.noticeGiven).toBe("2026-11-08");
    expect(facts.resignationDate).toBe("2026-11-08");
  });

  it("on: \"she resigned 11/8\" is the Resignation Date only; the notice date stays blank", () => {
    vi.stubEnv("EXIT_NOTICE_STATED_ONLY_ENABLED", "true");
    const facts = readExitFacts(SAID, TODAY);
    expect(facts.noticeGiven).toBeNull();
    expect(facts.resignationDate).toBe("2026-11-08");
  });

  it.each([
    "exit form for Tamsin Okafor, she gave notice on 11/8",
    "exit form for Tamsin Okafor, she gave her two weeks' notice on 11/8",
    "exit form for Tamsin Okafor, she turned in her resignation letter on 11/8",
    "exit form for Tamsin Okafor, she submitted her resignation on 11/8",
    "exit form for Tamsin Okafor, she resigned 11/8 and gave two weeks notice",
  ])("on, notice stated: %s", (said) => {
    vi.stubEnv("EXIT_NOTICE_STATED_ONLY_ENABLED", "true");
    expect(readExitFacts(said, TODAY).noticeGiven).toBe("2026-11-08");
  });
});
