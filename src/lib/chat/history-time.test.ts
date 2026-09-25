import { afterEach, describe, expect, it, vi } from "vitest";

import { REPORTING_TIME_ZONE } from "@/lib/reporting/read/freshness-line";
import { activityNowIso, DEMO_ANCHOR } from "@/lib/utils/date";
import type { ChatConversation, ChatMessage } from "@/types";

import {
  CHAT_HISTORY_TIME_ZONE,
  formatChatTime,
  formatHistoryTimestamp,
  formatHistoryTimestampExact,
  groupConversationHistory,
  historySection,
  lastActivityAt,
  sortByLastActivity,
} from "./history-time";

function message(id: string, createdAt: string): ChatMessage {
  return { id, role: "user", content: "hello", createdAt };
}

function conversation(
  id: string,
  updatedAt: string,
  messages: ChatMessage[] = [message(`msg_${id}`, updatedAt)],
): ChatConversation {
  return {
    id,
    title: id,
    createdAt: messages[0]?.createdAt ?? updatedAt,
    updatedAt,
    attachedDocumentIds: [],
    messages,
  };
}

/* Central daylight time is UTC-5 in September. */
const A = conversation("conv_a", "2026-09-22T14:00:00.000Z"); // Sep 22, 9:00 AM CT
const B = conversation("conv_b", "2026-09-25T23:45:00.000Z"); // Sep 25, 6:45 PM CT
const C = conversation("conv_c", "2026-09-24T19:30:00.000Z"); // Sep 24, 2:30 PM CT
const NOW = new Date("2026-09-26T01:00:00.000Z"); // Sep 25, 8:00 PM CT

describe("chat history ordering", () => {
  it("lists the most recently active conversation first", () => {
    expect(sortByLastActivity([A, B, C]).map((entry) => entry.id)).toEqual([
      "conv_b",
      "conv_c",
      "conv_a",
    ]);
  });

  it("matches the specified example, timestamps included", () => {
    const rendered = groupConversationHistory([A, B, C], NOW)
      .flatMap((group) => group.items)
      .map((entry) => `${entry.id} — ${formatHistoryTimestamp(lastActivityAt(entry))}`);

    expect(rendered).toEqual([
      "conv_b — Sep 25, 2026 • 6:45 PM CT",
      "conv_c — Sep 24, 2026 • 2:30 PM CT",
      "conv_a — Sep 22, 2026 • 9:00 AM CT",
    ]);
  });

  it("moves an older conversation to the top when it gets a new message", () => {
    const continued: ChatConversation = {
      ...A,
      messages: [...A.messages, message("msg_new", "2026-09-26T00:30:00.000Z")],
    };

    expect(sortByLastActivity([B, C, continued]).map((entry) => entry.id)).toEqual([
      "conv_a",
      "conv_b",
      "conv_c",
    ]);
    const [today] = groupConversationHistory([B, C, continued], NOW);
    expect(today!.section).toBe("Today");
    expect(today!.items.map((entry) => entry.id)).toEqual(["conv_a", "conv_b"]);
  });

  it("uses the later of updatedAt and the newest turn as last activity", () => {
    /* A turn stamped after `updatedAt` still counts… */
    const stale = conversation("conv_s", "2026-09-20T12:00:00.000Z", [
      message("m1", "2026-09-20T12:00:00.000Z"),
      message("m2", "2026-09-25T12:00:00.000Z"),
    ]);
    expect(lastActivityAt(stale)).toBe("2026-09-25T12:00:00.000Z");

    /* …and so does an `updatedAt` later than every turn. */
    const touched = conversation("conv_t", "2026-09-25T15:00:00.000Z", [
      message("m1", "2026-09-20T12:00:00.000Z"),
    ]);
    expect(lastActivityAt(touched)).toBe("2026-09-25T15:00:00.000Z");
  });

  it("is not alphabetical and not by creation time", () => {
    const createdFirst = { ...conversation("conv_z", "2026-09-25T20:00:00.000Z"), createdAt: "2026-01-01T00:00:00.000Z" };
    const createdLast = { ...conversation("conv_a", "2026-09-24T20:00:00.000Z"), createdAt: "2026-09-24T20:00:00.000Z" };
    expect(sortByLastActivity([createdLast, createdFirst]).map((entry) => entry.id)).toEqual([
      "conv_z",
      "conv_a",
    ]);
  });

  it("does not reorder or modify the caller's conversations", () => {
    const input = [A, B, C];
    const snapshot = structuredClone(input);
    groupConversationHistory(input, NOW);
    expect(input).toEqual(snapshot);
    expect(input.map((entry) => entry.id)).toEqual(["conv_a", "conv_b", "conv_c"]);
  });

  it("orders ties deterministically and sinks unreadable timestamps", () => {
    const tie1 = conversation("conv_2", "2026-09-25T12:00:00.000Z");
    const tie2 = conversation("conv_1", "2026-09-25T12:00:00.000Z");
    const broken = conversation("conv_x", "not a date", []);
    expect(sortByLastActivity([broken, tie1, tie2]).map((entry) => entry.id)).toEqual([
      "conv_1",
      "conv_2",
      "conv_x",
    ]);
  });
});

describe("chat history timestamps are Central Time", () => {
  it("is the same zone the rest of the product renders in", () => {
    expect(CHAT_HISTORY_TIME_ZONE).toBe("America/Chicago");
    expect(CHAT_HISTORY_TIME_ZONE).toBe(REPORTING_TIME_ZONE);
  });

  it("renders the Central date, not the UTC date, for an evening conversation", () => {
    /* 00:05 UTC on the 26th is still the evening of the 25th in Central. */
    expect(formatHistoryTimestamp("2026-09-26T00:05:00.000Z")).toBe(
      "Sep 25, 2026 • 7:05 PM CT",
    );
  });

  it("follows daylight saving: CDT in summer, CST in winter", () => {
    expect(formatHistoryTimestampExact("2026-09-26T00:05:00.000Z")).toBe(
      "Sep 25, 2026 • 7:05 PM CDT",
    );
    expect(formatHistoryTimestamp("2026-12-16T01:05:00.000Z")).toBe(
      "Dec 15, 2026 • 7:05 PM CT",
    );
    expect(formatHistoryTimestampExact("2026-12-16T01:05:00.000Z")).toBe(
      "Dec 15, 2026 • 7:05 PM CST",
    );
  });

  it("handles the fall-back hour that happens twice", () => {
    /* 2026-11-01: 1:30 AM occurs once in CDT and again in CST. */
    expect(formatHistoryTimestampExact("2026-11-01T06:30:00.000Z")).toBe(
      "Nov 1, 2026 • 1:30 AM CDT",
    );
    expect(formatHistoryTimestampExact("2026-11-01T07:30:00.000Z")).toBe(
      "Nov 1, 2026 • 1:30 AM CST",
    );
  });

  it("formats midnight and noon as 12", () => {
    expect(formatHistoryTimestamp("2026-09-25T05:00:00.000Z")).toBe(
      "Sep 25, 2026 • 12:00 AM CT",
    );
    expect(formatHistoryTimestamp("2026-09-25T17:00:00.000Z")).toBe(
      "Sep 25, 2026 • 12:00 PM CT",
    );
  });

  it("renders a single turn's time in Central too", () => {
    expect(formatChatTime("2026-09-26T00:05:00.000Z")).toBe("7:05 PM CT");
  });

  it("draws nothing time-like for an unreadable value", () => {
    expect(formatHistoryTimestamp("nope")).toBe("—");
    expect(formatChatTime("")).toBe("—");
  });
});

describe("history sections around date boundaries", () => {
  /* 12:10 AM CDT on Sep 25 — just past Central midnight, still Sep 25 in UTC too. */
  const JUST_AFTER_MIDNIGHT = new Date("2026-09-25T05:10:00.000Z");

  it("splits Today and Yesterday at Central midnight, not UTC midnight", () => {
    expect(historySection("2026-09-25T05:00:00.000Z", JUST_AFTER_MIDNIGHT)).toBe("Today"); // 12:00 AM CT
    expect(historySection("2026-09-25T04:59:00.000Z", JUST_AFTER_MIDNIGHT)).toBe("Yesterday"); // 11:59 PM CT
    /* Same UTC day as "now", but the previous Central day. */
    expect(historySection("2026-09-25T00:30:00.000Z", JUST_AFTER_MIDNIGHT)).toBe("Yesterday");
  });

  it("keeps an evening conversation in Today after UTC has rolled over", () => {
    expect(historySection("2026-09-26T00:05:00.000Z", NOW)).toBe("Today");
    expect(historySection("2026-09-25T04:00:00.000Z", NOW)).toBe("Yesterday"); // Sep 24, 11 PM CT
  });

  it("puts two to seven days back in Previous 7 Days and older in Earlier", () => {
    expect(historySection("2026-09-23T17:00:00.000Z", NOW)).toBe("Previous 7 Days"); // 2 days
    expect(historySection("2026-09-18T05:00:00.000Z", NOW)).toBe("Previous 7 Days"); // 7 days, 12:00 AM
    expect(historySection("2026-09-18T04:59:00.000Z", NOW)).toBe("Earlier"); // Sep 17, 11:59 PM
    expect(historySection("2025-12-01T12:00:00.000Z", NOW)).toBe("Earlier");
  });

  it("counts calendar days correctly across a daylight-saving change", () => {
    const afterFallBack = new Date("2026-11-02T06:30:00.000Z"); // Nov 2, 12:30 AM CST
    expect(historySection("2026-11-01T05:30:00.000Z", afterFallBack)).toBe("Yesterday"); // Nov 1, 12:30 AM CDT
    const afterSpringForward = new Date("2026-03-09T05:30:00.000Z"); // Mar 9, 12:30 AM CDT
    expect(historySection("2026-03-08T06:30:00.000Z", afterSpringForward)).toBe("Yesterday"); // Mar 8, 12:30 AM CST
  });

  it("treats a future stamp as Today rather than dropping it", () => {
    expect(historySection("2026-09-27T12:00:00.000Z", NOW)).toBe("Today");
  });

  it("groups in fixed order, omits empty sections, newest first within each", () => {
    const today2 = conversation("conv_t2", "2026-09-25T13:00:00.000Z");
    const earlier = conversation("conv_e", "2026-08-01T13:00:00.000Z");
    const groups = groupConversationHistory([A, earlier, C, today2, B], NOW);
    expect(groups.map((group) => [group.section, group.items.map((entry) => entry.id)])).toEqual([
      ["Today", ["conv_b", "conv_t2"]],
      ["Yesterday", ["conv_c"]],
      ["Previous 7 Days", ["conv_a"]],
      ["Earlier", ["conv_e"]],
    ]);
  });
});

describe("the chat activity clock", () => {
  const original = process.env.NEXT_PUBLIC_DEMO_MODE;
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = original;
    vi.useRealTimers();
  });

  it("is the real time in live mode, so activity sorts across page loads", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T23:45:00.000Z"));
    expect(activityNowIso()).toBe("2026-09-25T23:45:00.000Z");
  });

  it("stays on the demo anchor in demo mode", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const stamped = Date.parse(activityNowIso());
    expect(stamped).toBeGreaterThanOrEqual(Date.parse(DEMO_ANCHOR));
    expect(stamped).toBeLessThan(Date.parse(DEMO_ANCHOR) + 24 * 3_600_000);
  });
});
