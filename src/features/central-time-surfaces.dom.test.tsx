// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * "THE WHOLE APP AND CHAT SHOULD BE IN CT" (Pau, 15 Nov 2026). Each surface that showed a time or a day in UTC, or in
 * whatever zone the host or browser was in, now shows the business zone (Central in production, NEXT_PUBLIC_BUSINESS_TIMEZONE).
 * The stored value is UTC and is not touched. 03:30 UTC on the 15th is 9:30 PM CT on the 14th: the case a host-zone
 * formatter gets wrong.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE = "America/Chicago";
});

const EVENING = "2026-11-15T03:30:00Z";

describe("each surface reads Central time", () => {
  it("Admin feedback queue: the time of a row (was no zone: the server's UTC)", async () => {
    const { longDate, shortDate } = await import("./admin/analytics/feedback-queue");
    expect(longDate(EVENING)).toBe("Nov 14, 9:30 PM CT");
    expect(shortDate(EVENING)).toBe("Nov 14");
  });
  it("Admin usage shape: the day of a point (was no zone)", async () => {
    const { shortDate } = await import("./admin/analytics/usage-shape");
    expect(shortDate(EVENING)).toBe("Nov 14");
  });
  it("L10 assistant history: the time of a chat (was no zone)", async () => {
    const { when } = await import("./l10/assistant/AssistantPanel");
    expect(when(EVENING)).toBe("Nov 14, 9:30 PM CT");
  });
  it("L10 notifications: the date older notes show (was no zone)", async () => {
    const { timeAgo } = await import("./l10/notifications/logic");
    expect(timeAgo(EVENING, Date.parse("2026-12-30T00:00:00Z"))).toBe("Nov 14");
  });
  it("Salon Performance data-source panel: the load time (was \"… UTC\")", async () => {
    const { stamp } = await import("./reports/salon-performance/data-source-panel");
    expect(stamp("2026-11-14T12:01:00Z")).toBe("Nov 14, 2026, 6:01 AM CT");
    expect(stamp(null)).toBe("Not recorded");
  });
});
