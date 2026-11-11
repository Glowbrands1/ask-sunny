import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNED } from "@/app/api/chat/replay-pack/nov9-exit-letter-signer-cases";

import { withoutLetterGreeting, withoutLetterSigner } from "./letter-signer";

/**
 * EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED, ported from the sibling app (QA's round-6 live test there, 9 Nov 2026), in
 * QA's wording with this app's salon and title and the people invented.
 */
const FLAG = "EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED";

beforeEach(() => vi.stubEnv(FLAG, "true"));
afterEach(() => vi.unstubAllEnvs());

describe("withoutLetterSigner", () => {
  it("off: the turn as it was", () => {
    vi.stubEnv(FLAG, "");
    expect(withoutLetterSigner({ question: SIGNED })).toBe(SIGNED);
  });

  it("on: QA's turn is read without the sign-off, the letter's closing quote kept", () => {
    const read = withoutLetterSigner({ question: SIGNED });
    expect(read).not.toMatch(/Maren Tollefsen|District Manager/);
    expect(read.endsWith("Please return your salon key.'")).toBe(true);
    expect(read.startsWith("create an exit form for Corvin Ashdale, tanning consultant at Kearney.")).toBe(true);
  });

  it("on: other closing titles, with or without a closing quote", () => {
    expect(withoutLetterSigner({ question: "exit form for Corvin Ashdale. Letter: you are terminated. Maren Tollefsen, Regional Director" })).toBe(
      "exit form for Corvin Ashdale. Letter: you are terminated.",
    );
    expect(withoutLetterSigner({ question: "create a CA for Corvin Ashdale: \"you were late twice. Maren Tollefsen, Salon Manager\"" })).toBe(
      "create a CA for Corvin Ashdale: \"you were late twice.\"",
    );
  });

  it("on: a letter the form's person signs is kept", () => {
    const own = "create an exit form for Corvin Ashdale. Here is his resignation letter: 'I am resigning effective 11-6-26. Corvin Ashdale, Tanning Consultant'";
    expect(withoutLetterSigner({ question: own })).toBe(own);
  });

  it("on: no form's person named, or no sign-off: the turn as it was", () => {
    const unnamed = "Here is the termination letter: 'your employment is terminated. Maren Tollefsen, District Manager'";
    expect(withoutLetterSigner({ question: unnamed })).toBe(unnamed);
    const plain = "create an exit form for Corvin Ashdale, he quit on 11-6-26 with no notice";
    expect(withoutLetterSigner({ question: plain })).toBe(plain);
  });
});

describe("withoutLetterGreeting (LETTER_GREETING_NOT_NAME_ENABLED)", () => {
  /** QA (9 Nov 2026): "Dear <name>," became the employee "Dear <name>". The people invented. */
  const body = "\n\nThis letter confirms that your employment is terminated, effective 11/08/2026.";
  beforeEach(() => vi.stubEnv("LETTER_GREETING_NOT_NAME_ENABLED", "true"));

  it("off: the turn as it was", () => {
    vi.stubEnv("LETTER_GREETING_NOT_NAME_ENABLED", "");
    expect(withoutLetterGreeting(`Dear Marcus Tellefsen,${body}`)).toBe(`Dear Marcus Tellefsen,${body}`);
  });

  it("on: QA's salutations are left out before the addressee", () => {
    for (const greeting of ["Dear", "Hi", "Hello", "Hey", "To", "Attn:", "ATTN", "Good morning", "Good afternoon", "Greetings", "dear"]) {
      expect(withoutLetterGreeting(`${greeting} Marcus Tellefsen,${body}`), greeting).toBe(`Marcus Tellefsen,${body}`);
    }
    expect(withoutLetterGreeting(`Hi Marcus,${body}`)).toBe(`Marcus,${body}`);
  });

  it("on: after the request's sentence, or a quote", () => {
    expect(withoutLetterGreeting(`I need an exit form with this information. Dear Marcus Tellefsen,${body}`)).toBe(
      `I need an exit form with this information. Marcus Tellefsen,${body}`,
    );
    expect(withoutLetterGreeting(`Here is the letter: 'Dear Marcus Tellefsen, your employment is terminated.'`)).toBe(
      `Here is the letter: 'Marcus Tellefsen, your employment is terminated.'`,
    );
  });

  it("on: not a salutation — the words are kept", () => {
    const plain = ["Talk to Marcus Tellefsen, he knows the details", "Say hi to Marcus, please", "create an exit form for Marcus Tellefsen, he quit"];
    for (const text of plain) expect(withoutLetterGreeting(text)).toBe(text);
  });
});
