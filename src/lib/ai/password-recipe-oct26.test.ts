import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPLY_NOTE, redactSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * HOW A DEFAULT PASSWORD IS BUILT NEVER REACHES CHAT
 * (SENSITIVE_DEFAULT_RECIPE_REDACT_ENABLED, with SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * QA-5 and the coordinator, 26 Oct 2026: with the password note on, a
 * sentence that says how a default or first sign-in password is made from a
 * name, a year or a birthday was kept: it names no value. Every stand-in is
 * INVENTED. Each sentence in its own words, lowercase, sentence case and CAPS.
 */

afterEach(() => vi.unstubAllEnvs());
// Each test sets the flags it needs; flag-off pins hold whatever the environment has on.
beforeEach(() => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "");
  vi.stubEnv("SENSITIVE_DEFAULT_RECIPE_REDACT_ENABLED", "");
  vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "");
});

const on = () => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
  vi.stubEnv("SENSITIVE_DEFAULT_RECIPE_REDACT_ENABLED", "true");
};
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [
  ...new Set([text, lower(text), sentence(text), text.toUpperCase()]),
];

const RECIPES = [
  "The starter code is Bluebird and the year.",
  "The default login is their first name plus the year they started.",
  "Your first-time password is your last name followed by 1.",
  "Sign in the first time with your birthday.",
  "Log in with your birthday as the password.",
  "The initial PIN is the store number then the last two digits of the year.",
];

/** After a default-password sentence, a recipe with no password word is one too. */
const IN_WINDOW = [
  "New hires get a default password. It's their first name plus the year they started.",
  "Ask about the default password.\n\nIt is your last name followed by 1.",
];

/** The manual's guidance and ordinary sign-in help: kept. */
const KEPT = [
  "Do not use your birthday or name as a password.",
  "Your password must not contain your name or birthday.",
  "The password should be 8-10 characters long.",
  "Use letters, numbers and a symbol.",
  "Change your password every quarter.",
  "Do not use default passwords, i.e., password###.",
  "If you're locked out, use Forgot your password? on the log-in screen, or ask your manager to reset it.",
  "Log in with your employee ID.",
  "Sign in with your work email.",
  "Clock in with your employee number at the start of your shift.",
  "Enter the year and month of the pay period.",
  "Your manager will send the first name and last name of each new hire to HR.",
];

describe("flag on: a recipe sentence is removed", () => {
  it.each(RECIPES.flatMap(registers))("%s", (text) => {
    on();
    // Nothing of it is left, so the reset note stands in, never an empty answer.
    expect(redactSensitiveDefaults(text, null)).toBe(REPLY_NOTE);
  });

  it.each(IN_WINDOW.flatMap(registers))("in the window: %s", (text) => {
    on();
    const out = redactSensitiveDefaults(text, null);
    expect(out).not.toMatch(/followed by|plus the year/i);
  });
});

describe("flag on: guidance and ordinary sign-in help are kept", () => {
  it.each(KEPT.flatMap(registers))("%s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });

  it("a page with the manual's lines and a recipe loses only the recipe", () => {
    on();
    const page =
      "Do not use default passwords, i.e., password###.\nThe password should be 8-10 characters long.\nThe starter code is Bluebird and the year.";
    expect(redactSensitiveDefaults(page, null)).toBe(
      "Do not use default passwords, i.e., password###.\nThe password should be 8-10 characters long.",
    );
  });
});

/** Thirty-one harmless password and sign-in sentences: none is touched. */
const HARMLESS = [
  "Passwords expire every 90 days.",
  "Use a passphrase with at least three words.",
  "Never share your password with anyone, including your manager.",
  "Your user name is your work email.",
  "Sign in with your Woven account and then open Schedules.",
  "Log in with your user name and password.",
  "Enter your password and then click Sign in.",
  "Your password must be changed after your first login.",
  "On your first day, your manager will help you log in.",
  "Reset your password with the link sent to your email.",
  "Your PIN is used to clock in at the register.",
  "Pick a password that is not your name, birthday or the year.",
  "Add a number and a symbol to the end of your password.",
  "You can change your PIN with your manager's help.",
  "The first time you log in, you'll be asked to change your password.",
  "Paycor sends your user name to your personal email after your hire date.",
  "Codes for the alarm are given out by the store manager.",
  "Use your employee number to clock in.",
  "Your login is your first name and last initial.",
  "Contact IT with your employee ID and the store number if you're locked out.",
  "Make your password at least 8 characters with a capital letter.",
  "Do not write your password down.",
  "Choose a password you have not used in the last year.",
  "The PIN must be 4 digits.",
  "Update your birthday in Paycor if it is wrong.",
  "Your manager enters your hire date and start year in Woven.",
  "After your first login, set up two-factor sign-in with your phone number.",
  "Sign in to the register with your employee number then your PIN.",
  "Your schedule is posted with the store number at the top.",
  "Passwords are case sensitive.",
  "Sign in with your employee number as the user name and your own password.",
];

describe("flag on: harmless password and sign-in sentences are kept", () => {
  it.each(HARMLESS)("%s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});

/* QA-5, 26 Oct 2026, second probe: recipes that name the secret only as "first sign-in", "Use …" or "It's …". */
const QA5_RECIPES = [
  "It's their first name plus the year they started.",
  "Use your last name followed by 1.",
  "Your first sign-in is your last name then the year you started.",
  "Use Bluebird plus the last two digits of the year.",
  "First-time sign-in: your birthday, then the month.",
];

describe("flag on: QA-5's second probe", () => {
  it.each(QA5_RECIPES.flatMap(registers))("removed: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(REPLY_NOTE);
  });

  it.each(
    [
      "On your first day, sign in to Revel with the user name your manager gave you.",
      "Use your employee number to clock in.",
      "Use the store number on the deposit slip.",
      "It's the first name on the schedule.",
    ].flatMap(registers),
  )("kept: %s", (text) => {
    on();
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});

describe("recipe flag off: judged as before", () => {
  it.each([
    "Sign in the first time with your birthday.",
    "Your first-time password is your last name followed by 1.",
  ])("the password note alone keeps what it kept: %s", (text) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    const before = redactSensitiveDefaults(text, null);
    vi.stubEnv("SENSITIVE_DEFAULT_RECIPE_REDACT_ENABLED", "true");
    expect(redactSensitiveDefaults(text, null)).not.toBe(text);
    vi.stubEnv("SENSITIVE_DEFAULT_RECIPE_REDACT_ENABLED", "");
    expect(redactSensitiveDefaults(text, null)).toBe(before);
  });

  it.each(RECIPES)("both flags off: the text as given: %s", (text) => {
    expect(redactSensitiveDefaults(text, null)).toBe(text);
  });
});
