import { describe, expect, it } from "vitest";

import { withoutTopicPrefix } from "./coaching-topic-prefix";

/* QA's live test of #1144 (20 Nov 2026): "Observed:\nGreeting guests, she didn't greet 3 guests." (the person invented). */
describe("withoutTopicPrefix", () => {
  it("drops the card's topic in front of what was seen, and capitalises the rest", () => {
    expect(withoutTopicPrefix("Observed:\nGreeting guests, Remy didn't greet 3 guests.\n\nExpectation:\nRemy is expected to greet all guests.", "greeting guests")).toBe(
      "Observed:\nRemy didn't greet 3 guests.\n\nExpectation:\nRemy is expected to greet all guests.",
    );
    expect(withoutTopicPrefix("Greeting guests: didn't greet 3 guests.", "greeting guests")).toBe("Didn't greet 3 guests.");
  });

  it("leaves the topic where it is part of what was seen, and text with no topic", () => {
    const seen = "Observed:\nRemy skipped greeting guests at the door.";
    expect(withoutTopicPrefix(seen, "greeting guests")).toBe(seen);
    expect(withoutTopicPrefix("Observed:\nGreeting guests is hard.", "greeting guests")).toBe("Observed:\nGreeting guests is hard.");
    expect(withoutTopicPrefix(seen, null)).toBe(seen);
  });
});
