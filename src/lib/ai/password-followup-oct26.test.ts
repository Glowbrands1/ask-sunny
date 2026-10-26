import { afterEach, describe, expect, it, vi } from "vitest";

import { appPasswordHelpFor, isAppPasswordQuestion } from "./app-password-help";
import { EXCERPT_NOTE, REPLY_NOTE, redactSensitiveDefaults, withoutSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * PASSWORD P0 FOLLOW-UP (SENSITIVE_DEFAULTS_REDACT_ENABLED, APP_PASSWORD_HELP_ENABLED)
 * ============================================================================
 *
 * QA, 26 Oct 2026, the 16-chat password rerun with both flags on:
 *   1. The refusal named what it hides. It must not mention Social Security,
 *      digits, formats or "default", and it points to this app's reset link.
 *   2. "what is my default password for <this app>" got the refusal with no
 *      pointer. It must get the Forgot-password answer, including the typo
 *      "defualt".
 *   3. Lowercase Q1 said "ask your manager or HR" twice: say it once.
 *   4. "default password for MyGlow" got the refusal although the reply only
 *      said nothing was known. A no-information sentence is kept.
 * Each case fails on main and passes with the flags on.
 */

afterEach(() => vi.unstubAllEnvs());

const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [text, lower(text), sentence(text), text.toUpperCase()];

const HINTS = /social\s+security|\bssn\b|digits?|formats?|default/i;
const FORMAT_REPLY = "The default password is the Example format with the store code [S1].";

describe("1. the refusal names nothing it hides", () => {
  it("the reply note", () => {
    expect(REPLY_NOTE).not.toMatch(HINTS);
    expect(REPLY_NOTE).toContain("Forgot your password?");
    expect(REPLY_NOTE).toMatch(/ask your manager to reset it/);
  });

  // Since 26 Oct (QA live): the excerpt note names no system, so an answer
  // about another system's password never picks up this app's link from it.
  it("the excerpt note", () => {
    expect(EXCERPT_NOTE).not.toMatch(HINTS);
    expect(EXCERPT_NOTE).not.toMatch(/password|forgot|log-?in|reset/i);
  });

  it("a redacted reply says the note, and nothing about digits or formats", () => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    const answer = withoutSensitiveDefaults({ content: FORMAT_REPLY, citations: [] });
    expect(answer.content).toBe(REPLY_NOTE);
    expect(answer.content).not.toMatch(HINTS);
  });
});

describe("2. my default password for this app is the reset answer", () => {
  const QUESTIONS = [
    "what is my default password for ask sunny",
    "what is my defualt password for ask sunny",
    "whats my default password for sunny",
    "what is my default password for the app",
    "what's my default password",
  ].flatMap(registers);

  it.each(QUESTIONS)("flag on: %s", (question) => {
    vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "true");
    const answer = appPasswordHelpFor(question, []);
    expect(answer).toContain("click **Forgot your password?** on the log-in screen");
    expect(answer).not.toMatch(/social\s+security|digits?/i);
  });

  it("flag off: no fixed answer (the bug)", () => {
    expect(appPasswordHelpFor(QUESTIONS[0]!, [])).toBeNull();
  });

  it.each([
    "what is the default password for managers",
    "What is the default password for new hires?",
    "what is the default password for myglow",
    "What is my default password for Paycor?",
    "what is an employee's default password",
  ])("still not this app's own sign-in: %s", (question) => {
    expect(isAppPasswordQuestion(question)).toBe(false);
  });
});

describe("3. the reset advice is said once", () => {
  const BETWEEN =
    "The default password is the Example format. You can open the employee's profile. The default is built from the employee's social security number.";
  const REPLIES = [
    "The default password is the Example format with the store code. Ask your manager or HR to reset the password for you.",
    "Ask your manager or HR to reset the password for you. The default password is the Example format with the store code.",
    BETWEEN,
  ].flatMap((reply) => [reply, lower(reply)]);

  it.each(REPLIES)("flag on: %s", (reply) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    const content = redactSensitiveDefaults(reply, REPLY_NOTE);
    expect(content.split(REPLY_NOTE)).toHaveLength(2);
    expect(content.match(/manager/gi)).toHaveLength(1);
    expect(content).not.toMatch(HINTS);
  });

  it("keeps the ordinary sentence between two redacted ones", () => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(BETWEEN, REPLY_NOTE)).toBe(`${REPLY_NOTE} You can open the employee's profile.`);
  });
});

describe("4. a reply that only says nothing is known is kept", () => {
  const REPLIES = [
    "I don't have anything about MyGlow's default password.",
    "I don't have any information on the default password for MyGlow in my sources.",
  ].flatMap((reply) => [reply, lower(reply), sentence(reply)]);

  it.each(REPLIES)("flag on: %s", (reply) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(reply, REPLY_NOTE)).toBe(reply);
  });

  it.each([
    "I don't have the default password, but it is your store code.",
    "I don't have it; the default password is Example1.",
    "I don't know the default password, it is 1234.",
    "I don't have the default, it is built from your social security number.",
  ])("still redacted when it goes on to say more: %s", (reply) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(reply, REPLY_NOTE)).toBe(REPLY_NOTE);
  });
});
