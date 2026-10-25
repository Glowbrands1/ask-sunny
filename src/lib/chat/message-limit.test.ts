import { describe, expect, it } from "vitest";

import {
  chatMessageLimit,
  LEGACY_MESSAGE_LIMIT,
  LONG_MESSAGE_LIMIT,
  messageLengthStatus,
  messageTooLongNotice,
} from "./message-limit";

/**
 * The warning a manager sees before sending (Pau, 25 Oct 2026: warn before
 * sending, never cut). The composer renders `notice` and disables send when
 * `canSend` is false; the route's 400 uses `messageTooLongNotice`, so the two
 * say the same thing.
 */

describe("the limit", () => {
  it("is 4,000 with the flag off and 12,000 with it on", () => {
    expect(chatMessageLimit(false)).toBe(LEGACY_MESSAGE_LIMIT);
    expect(chatMessageLimit(false)).toBe(4_000);
    expect(chatMessageLimit(true)).toBe(LONG_MESSAGE_LIMIT);
    expect(chatMessageLimit(true)).toBe(12_000);
  });
});

describe("the counter before sending", () => {
  it("says nothing below 90% of the limit", () => {
    const status = messageLengthStatus("x".repeat(10_799), LONG_MESSAGE_LIMIT);
    expect(status).toMatchObject({ state: "ok", canSend: true, notice: null, remaining: 1_201 });
  });

  it("turns into a warning at 90% and still sends", () => {
    const status = messageLengthStatus("x".repeat(10_800), LONG_MESSAGE_LIMIT);
    expect(status.state).toBe("near");
    expect(status.canSend).toBe(true);
    expect(status.notice).toBe("1,200 characters left of 12,000.");
  });

  it("sends at exactly the limit", () => {
    const status = messageLengthStatus("x".repeat(12_000), LONG_MESSAGE_LIMIT);
    expect(status).toMatchObject({ state: "near", canSend: true, remaining: 0 });
  });

  it("blocks one character over, with a clear message, and leaves the text alone", () => {
    const text = "x".repeat(12_001);
    const status = messageLengthStatus(text, LONG_MESSAGE_LIMIT);
    expect(status.state).toBe("over");
    expect(status.canSend).toBe(false);
    expect(status.remaining).toBe(-1);
    expect(status.notice).toBe(
      "This message is 12,001 characters. The limit is 12,000. Shorten it or split it into two messages. Nothing was cut.",
    );
    expect(text).toHaveLength(12_001);
  });

  it("counts the way the server does: surrounding whitespace is not counted", () => {
    const status = messageLengthStatus(`  ${"x".repeat(12_000)}\n\n`, LONG_MESSAGE_LIMIT);
    expect(status.length).toBe(12_000);
    expect(status.canSend).toBe(true);
  });

  it("warns at 3,600 and blocks over 4,000 with the flag off limit", () => {
    expect(messageLengthStatus("x".repeat(3_600), LEGACY_MESSAGE_LIMIT).state).toBe("near");
    expect(messageLengthStatus("x".repeat(4_001), LEGACY_MESSAGE_LIMIT).canSend).toBe(false);
  });

  it("uses the same sentence as the route's 400", () => {
    expect(messageLengthStatus("x".repeat(12_001), LONG_MESSAGE_LIMIT).notice).toBe(
      messageTooLongNotice(12_001, 12_000),
    );
  });
});
