import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPLY_NOTE, redactSensitiveDefaults, withoutSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * NOTHING AFTER A DEFAULT-PASSWORD SENTENCE HANDS OUT A VALUE
 * (SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * QA-3 and QA-5, 26 Oct 2026: with the manual's forbid kept, the sentence
 * after it was judged alone and never says "password", so "Do not use default
 * passwords. Instead use Welcome2024." leaked the value. The window after a
 * default-password sentence, up to a blank line, is now deny-by-default.
 * Every value below is an INVENTED stand-in.
 */

afterEach(() => vi.unstubAllEnvs());
// Each test sets the flags it needs; flag-off pins hold whatever the environment has on.
beforeEach(() => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "");
  vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "");
});

const on = () => vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [...new Set([text, lower(text), sentence(text), text.toUpperCase()])];

const FORBID = "Do not use default passwords.";

/** QA-3's and QA-5's held leaks, with the value that must not survive. */
const LEAKS: readonly { text: string; value: string }[] = [
  { text: `${FORBID} Instead use Welcome2024.`, value: "welcome2024" },
  { text: `${FORBID} The default is Welcome2024.`, value: "welcome2024" },
  { text: `${FORBID} The default: Welcome2024.`, value: "welcome2024" },
  { text: `${FORBID} Welcome2024 is the one.`, value: "welcome2024" },
  { text: `${FORBID} Use Welcome2024 instead.`, value: "welcome2024" },
  { text: `${FORBID} The starting one is Welcome2024.`, value: "welcome2024" },
  { text: `${FORBID}\nInstead use Welcome2024.`, value: "welcome2024" },
  { text: `${FORBID}\nWelcome2024`, value: "welcome2024" },
  { text: `${FORBID} Instead use welcome.`, value: "welcome" },
  { text: `${FORBID} It is sunshine.`, value: "sunshine" },
  { text: `${FORBID} The starting one is sunshine.`, value: "sunshine" },
  { text: `${FORBID} Sunshine is the one.`, value: "sunshine" },
  { text: `${FORBID} Use sunshine instead.`, value: "sunshine" },
  { text: `${FORBID} Ask your manager. Then type Welcome2024.`, value: "welcome2024" },
];

describe("flag on: the value after a kept forbid is removed, in every register", () => {
  it.each(LEAKS.flatMap(({ text, value }) => registers(text).map((typed) => ({ typed, value }))))(
    "$typed",
    ({ typed, value }) => {
      on();
      const out = redactSensitiveDefaults(typed, null);
      expect(out.toLowerCase()).not.toContain(value);
      expect(out.toLowerCase()).toContain("do not use default passwords");
    },
  );

  it("a reply to a default-password question gets the note, never the value", () => {
    on();
    const answer = withoutSensitiveDefaults({ content: LEAKS[0]!.text, citations: [] }, "what is the default password");
    expect(answer.content).toContain(REPLY_NOTE);
    expect(answer.content).not.toMatch(/welcome2024/i);
  });
});

describe("flag on: the manual's own guidance and a normal policy answer stay intact", () => {
  const POLICY = [
    "▪ Do not use default passwords, i.e., password###.",
    "▪ The password should be 8-10 characters long.",
    "▪ Include numbers.",
    "▪ Include special characters, i.e., */&$#@.",
  ].join("\n");
  const ANSWER =
    "Do not use default passwords. Choose a strong password. The password should be 8-10 characters long and include numbers and special characters [S1]. See the IT section of the manual.";

  it.each(registers(POLICY))("the manual's lines: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });

  it.each(registers(ANSWER))("a policy answer: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });

  it("a heading after the forbid is kept", () => {
    on();
    const text = `${FORBID}\nSecurity`;
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });

  it.each(registers(`${FORBID}\n\nChange your password every quarter.`))("a legit paragraph after a blank line: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });

  it("with no default-password sentence nothing is suspect", () => {
    on();
    const text = "Use Woven to post the schedule. The code is A12 on the door.";
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});

/*
 * QA-3 and QA-5, coordinator, 26 Oct 2026: a blank line is no boundary in a
 * knowledge excerpt. The window stays open across one or two blank lines, a
 * heading, a "Note:" line and into a bullet.
 */
describe("flag on: the window stays open past a paragraph break", () => {
  const ACROSS: readonly { text: string; value: string }[] = [
    { text: `${FORBID}\n\nWelcome2024`, value: "welcome2024" },
    { text: `${FORBID}\n\nThe default is Welcome2024.`, value: "welcome2024" },
    { text: `${FORBID}\n\n\nWelcome2024`, value: "welcome2024" },
    { text: `${FORBID}\nSecurity\nWelcome2024`, value: "welcome2024" },
    { text: `${FORBID}\n\nSecurity\n\nInstead use Welcome2024.`, value: "welcome2024" },
    { text: `${FORBID}\nNote: ask your manager first.\nWelcome2024`, value: "welcome2024" },
    { text: `${FORBID}\n\n- Welcome2024`, value: "welcome2024" },
    { text: `${FORBID}\n\n- It is bluebird.`, value: "bluebird" },
  ];

  it.each(ACROSS.flatMap(({ text, value }) => registers(text).map((typed) => ({ typed, value }))))("$typed", ({ typed, value }) => {
    on();
    const out = redactSensitiveDefaults(typed, null);
    expect(out.toLowerCase()).not.toContain(value);
    expect(out.toLowerCase()).toContain("do not use default passwords");
  });

  it.each(registers(`${FORBID}\n\nSecurity\n\nNote: change your password every quarter.`))("kept: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});

describe("flag off: the text as given", () => {
  it.each(LEAKS.map(({ text }) => text))("%s", (text) => {
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});
