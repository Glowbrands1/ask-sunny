import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types";

import { asksTheApp, withoutQuestionsBeforeRequest } from "./question-turns-not-account";

/*
 * QUESTION_TURNS_NOT_ACCOUNT_ENABLED. The manager's words are verbatim (Pau, sf-s25, 5 Nov 2026); the person is invented.
 * The replay pack runs the chat: `nov5-pau-sf-s21-s25-cases.ts` (sf-s25).
 */
const Q1 = "closing policy";
const Q2 = "What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it";
const REQUEST =
  "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";
const turn = (role: "user" | "assistant", content: string) => ({ id: content.slice(0, 8), role, content }) as ChatMessage;
const HISTORY = [turn("user", Q1), turn("assistant", "From the manual …"), turn("user", Q2), turn("assistant", "That falls under …")];

afterEach(() => {
  delete process.env.QUESTION_TURNS_NOT_ACCOUNT_ENABLED;
});

describe("questions asked before the request", () => {
  it("reads the policy questions, never an account put as a question", () => {
    expect(asksTheApp(Q1)).toBe(true);
    expect(asksTheApp(Q2)).toBe(true);
    expect(asksTheApp("can you help, she was late 3 times this week?")).toBe(false);
    expect(asksTheApp(REQUEST)).toBe(false);
  });

  it("are left out of the request's history with the flag on; as before off, or once a card was made", () => {
    expect(withoutQuestionsBeforeRequest(REQUEST, HISTORY)).toHaveLength(4);
    process.env.QUESTION_TURNS_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutQuestionsBeforeRequest(REQUEST, HISTORY)).toEqual([]);
    expect(withoutQuestionsBeforeRequest("what policy is it?", HISTORY)).toHaveLength(4);
    const carded = [...HISTORY, turn("assistant", "I'll draft a **Corrective Action Form** for **Wynne Sarrow**")];
    expect(withoutQuestionsBeforeRequest(REQUEST, carded)).toHaveLength(5);
  });
});
