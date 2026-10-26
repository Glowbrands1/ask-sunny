import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redactSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * EVERY SIGN-IN SENTENCE IN THE KNOWLEDGE BASE, THROUGH THE REDACTOR
 * (SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * Coordinator, 26 Oct 2026: run the sentences a read-only scan of this app's
 * knowledge base found (a default, temporary, starting or initial password or
 * log-in, or a Social Security mention) through the final redactor; none may
 * leave a digit string after "password", "default" or "temporary". Each
 * sentence is the scan's shape with EVERY value replaced by an invented
 * stand-in, every digit by 7, and every digit count or position by "some".
 */
const KB_SENTENCES = [
  "(Along with the some digits of the employee's social security number) Note: Resetting or updating a password in myGLOW may also reset passwords in connected systems to their default settings.",
  "• SunLync: The new employee will need to immediately go to SunLync and create a password, the SunLync default password is *Example7 • MyGlow: Then log in to MyGlow and set the default password to the same password they set for SunLync, the MyGlow default password is Ex4mpl7!",
  "SunLync: The new employee will need to immediately go to SunLync and create a password, the SunLync default password is *Example7 7.",
  "MyGlow: Then log in to MyGlow and set their password to the same password they set in SunLync, the MyGlow default password is Ex4mpl7!",
  "77 New Hire Password Process When onboarding a new employee, myGLOW will automatically generate their username and set them with a default password in SunLync and MyGlow.",
  "and the some digits of the employees SSN.",
  "plus the some numbers of the new hire's social security number.",
  "• Employee's name • some digits of the employee's social security number • Location • Enter the search fields and click Search.",
  "▪ Do not use default passwords, i.e., password777.",
  "Concur Initial Login You will receive your initial sign in information via email, from Concur.",
];
/** Scan sentences that name an SSN or sign-in without a value, kept as written. */
const KEPT = [
  "• Contact HR for changes to Gender, Ethnicity, Date of birth, and Social Security number.",
  "• When a last name change is requested, the employee must provide an ID and Social Security card.",
  "For individuals, this is generally your social security number (SSN).",
];

const VALUE_AFTER_WORD = /\b(?:pass\s?words?|default|temporary)\b[^.\n]{0,40}?\d/i;

beforeEach(() => vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("flag on: no value survives", () => {
  it.each(KB_SENTENCES.flatMap((text) => [text, text.toLowerCase()]))("%s", (text) => {
    const out = redactSensitiveDefaults(text);
    expect(out).not.toMatch(VALUE_AFTER_WORD);
    expect(out).not.toMatch(/example7|ex4mpl7|some (?:digits|numbers) of/i);
  });

  it("the whole scan as one page", () => {
    const out = redactSensitiveDefaults(KB_SENTENCES.join("\n"));
    expect(out).not.toMatch(VALUE_AFTER_WORD);
  });

  it.each(KEPT)("kept: %s", (text) => {
    expect(redactSensitiveDefaults(text)).toBe(text);
  });
});

describe("flag off: as retrieved (main)", () => {
  it("the text is returned as given", () => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "");
    const page = KB_SENTENCES.join("\n");
    expect(redactSensitiveDefaults(page)).toBe(page);
  });
});
