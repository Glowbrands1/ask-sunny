import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXCERPT_NOTE, isSensitiveSentence, redactSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * A FORBID THAT ALSO STATES A VALUE IS STILL REMOVED (SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * QA-5 and QA-3, 26 Oct 2026, on the first cut of the password-note fix: the
 * exemption for the manual's "Do not use default passwords" line kept any
 * sentence with that phrase in it, including ones that went on to state a
 * value. Only a pure forbid is kept now. Every value below is INVENTED.
 */

afterEach(() => vi.unstubAllEnvs());
// Each test sets the flags it needs; flag-off pins hold whatever the environment has on.
beforeEach(() => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "");
  vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "");
});


const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [...new Set([text, lower(text), sentence(text)])];

/** QA-5's four leak sentences, then QA-3's and the Dispatcher's further probes. */
const REMOVED = [
  "Never use the default password Welcome2024.",
  "Do not use the default password, which is Welcome2024.",
  "No default password is set; the default password is Welcome2024.",
  "Do not use default passwords but the first-time password is Temp123.",
  'The default password is "Welcome1".',
  "Default password: Welcome1",
  "Never use the default password (it is Welcome1).",
  "Do not use default passwords, the default password is Welcome1.",
  "Never use the default password Welcome.",
  "Do not use the default password Welcome1 for company logins.",
  "Your default password is Welcome1.",
  "The default password is built from the employee's social security number.",
  "New hires start with the temporary password Temp123.",
  "The starting password is the store number plus 2024.",
  "Do not use default passwords or share your social security number.",
  "Do not give out default passwords.",
  "The password is Welcome1, do not use default passwords.",
  // QA-5, second probe: a digit run after "password" is a value, not the manual's placeholder.
  "Do not use default passwords, i.e., password123.",
  "Do not use default passwords, i.e., password1234.",
  "Do not use default passwords, i.e., password2024.",
  "Do not use default passwords e.g. Welcome1.",
];

/** Pure forbids: the manual's guidance, kept. */
const KEPT = [
  "Do not use default passwords, i.e., password###.",
  "Do not use default passwords, i.e., passwordxxx.",
  "Don't use default passwords.",
  "Never use the default password.",
  "No default passwords are allowed.",
  "Avoid default passwords.",
  "Do not use default passwords for any company login.",
];

describe("removed, in every register", () => {
  it.each(REMOVED.flatMap(registers))("%s", (text) => {
    expect(isSensitiveSentence(text)).toBe(true);
  });
});

describe("kept, in every register", () => {
  it.each(KEPT.flatMap(registers))("%s", (text) => {
    expect(isSensitiveSentence(text)).toBe(false);
  });
});

describe("in a page of text", () => {
  it("Do not use default passwords. Default password: Welcome1 -> the forbid stays, the value goes", () => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    const out = redactSensitiveDefaults("Do not use default passwords.\nDefault password: Welcome1");
    expect(out).toBe(`Do not use default passwords.\n${EXCERPT_NOTE}`);
    expect(out).not.toMatch(/welcome1/i);
  });

  it.each(
    [
      "Never use the default password. It is Welcome2024.",
      "Never use the default password. The password is Welcome2024.",
      "Never use the default password. Use Welcome2024.",
      "Do not use default passwords.\nWinter2024",
      "- Do not use default passwords\n- Winter2024",
      "Do not use default passwords e.g. Welcome1.",
      'The temporary password is set by HR. It is "Welcome".',
    ].flatMap(registers),
  )("a value on the next line or sentence goes too: %s", (text) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(text)).not.toMatch(/welcome|winter2024/i);
  });

  it.each([
    "Never use the default password. It is prohibited by policy.",
    "Do not use default passwords.\nChange your password every quarter.",
  ])("an ordinary sentence after a forbid stays: %s", (text) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(text)).toBe(text);
  });

  it.each(REMOVED.slice(0, 4).flatMap(registers))("no value survives: %s", (text) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(`Password rules. ${text} Ask your manager.`)).not.toMatch(/welcome|temp123/i);
  });
});
