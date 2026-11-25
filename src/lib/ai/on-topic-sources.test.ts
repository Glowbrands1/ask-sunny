import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceCitation } from "@/types";

import { asksDailyStatsCoaching, cardOnTopic, onTopicCards } from "./on-topic-sources";

/**
 * SOURCES_ON_TOPIC_ENABLED (QA's live test, 24 Nov 2026): "What are the top coaching priorities in a Daily Stats
 * report?" showed one source card, the Confidential Information Policy p.22. The chat path and the loop are covered by
 * the replay pack (`nov24-daily-stats-coaching-source-on-topic-cases.ts`).
 */
const QA = "What are the top coaching priorities in a Daily Stats report?";

const card = (documentId: string, documentTitle: string, locator: string, excerpt: string): SourceCitation => ({ documentId, documentTitle, locator, excerpt, category: "policies_compliance", relevance: 0.4 });
const CONFIDENTIAL = card("doc-manual", "2025 JBA Policy Manual - Edited 5-2025", "Page 22 — Confidential Information Policy", "Company records and internal documents are never shared outside the company.");
const FRAMEWORK = card("doc-dsf", "ASK SUNNY Daily Stats Interpretation Framework", "PRIORITY DECISION TREE", "Choose the top three priorities.");
const CASH = card("doc-manual", "2025 JBA Policy Manual - Edited 5-2025", "Page 13 — Standards of Conduct", "o Register / Bank shortages; cash handling at the register.");

beforeEach(() => vi.stubEnv("SOURCES_ON_TOPIC_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("onTopicCards", () => {
  it(`"${QA}": the framework's card, never the Confidential Information Policy alone`, () => {
    expect(onTopicCards({ question: QA, cards: [CONFIDENTIAL], framework: [FRAMEWORK] })).toEqual([FRAMEWORK]);
  });

  it(`"${QA}" with no framework on file: the unrelated card is dropped, nothing is invented`, () => {
    expect(onTopicCards({ question: QA, cards: [CONFIDENTIAL], framework: [] })).toEqual([]);
  });

  it("the framework already cited is not shown twice", () => {
    expect(onTopicCards({ question: QA, cards: [FRAMEWORK, CONFIDENTIAL], framework: [FRAMEWORK] })).toEqual([FRAMEWORK]);
  });

  it("a card that shares the question's topic is kept, and every card with it", () => {
    const question = "What should I focus on for cash handling in the Daily Stats?";
    expect(onTopicCards({ question, cards: [CASH, CONFIDENTIAL], framework: [FRAMEWORK] })).toEqual([FRAMEWORK, CASH, CONFIDENTIAL]);
  });

  it.each([
    "What does the confidential information policy say about reports?",
    "can I wear a hoodie at work?",
    "where is the coaching form?",
  ])("not a Daily Stats question (%s): the cards as given", (question) => {
    expect(onTopicCards({ question, cards: [CONFIDENTIAL], framework: [FRAMEWORK] })).toEqual([CONFIDENTIAL]);
  });

  it("flag off: the cards as given", () => {
    vi.stubEnv("SOURCES_ON_TOPIC_ENABLED", "false");
    expect(onTopicCards({ question: QA, cards: [CONFIDENTIAL], framework: [FRAMEWORK] })).toEqual([CONFIDENTIAL]);
  });
});

describe("the readers", () => {
  it(`"${QA}" is a Daily Stats coaching-priorities question; "where is the coaching form?" is not`, () => {
    expect(asksDailyStatsCoaching(QA)).toBe(true);
    expect(asksDailyStatsCoaching("where is the coaching form?")).toBe(false);
  });

  it("the Confidential Information Policy shares no word of QA's question", () => {
    expect(cardOnTopic(QA, CONFIDENTIAL)).toBe(false);
    expect(cardOnTopic("What should I focus on for cash handling in the Daily Stats?", CASH)).toBe(true);
  });
});
