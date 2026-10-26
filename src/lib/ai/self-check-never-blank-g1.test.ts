import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManualChunk } from "@/lib/forms/official-policy-manual";

import { runSelfCheck, type OutgoingDraft } from "./self-check";

/**
 * QA G1, 25 Oct 2026 (production conv_mvodvqnz2qshh8u, turn 3, "The NCR and
 * Fitzpatrick Skin Type Chart, EFT Agreements"): the model finished — end_turn,
 * 1,388 output tokens, succeeded — but the stored reply was empty and the
 * manager saw "No answer was produced". The reply check ran after the trace:
 * every sentence cited a document that is not the policy manual, so the
 * citation fallback dropped them all, and a blank "stays blank".
 */

const manual: ManualChunk[] = [
  { chunkIndex: 0, page: 49, printedPage: 49, content: "", section: "Consent Forms", sections: [{ heading: "Consent Forms", page: 49 }] },
];

const reply: OutgoingDraft = {
  content:
    "Have each guest sign the NCR before the first session (New Client Registration, JBA Policy Manual p.3). " +
    "Record the skin type on the Fitzpatrick chart (Skin Type Chart, JBA Policy Manual p.7). " +
    "EFT Agreements are signed at the front desk (EFT Agreement, JBA Policy Manual p.11).",
  employeeName: null,
  actionPlan: null,
  chunks: manual,
  roster: [],
  question: "The NCR and Fitzpatrick Skin Type Chart, EFT Agreements",
};

/* The repair call fails, so the code's own fallback settles the reply. */
const noRepair = async () => {
  throw new Error("repair unavailable");
};

afterEach(() => vi.unstubAllEnvs());

describe("SELF_CHECK_NEVER_BLANK_ENABLED", () => {
  it("off: every sentence's citation fails and the reply is blanked (as in production)", async () => {
    const settled = await runSelfCheck(reply, noRepair);
    expect(settled.content.trim()).toBe("");
  });

  it("on: the model's own reply goes out instead of nothing", async () => {
    vi.stubEnv("SELF_CHECK_NEVER_BLANK_ENABLED", "true");
    const settled = await runSelfCheck(reply, noRepair);
    expect(settled.content).toBe(reply.content);
  });

  it("on: a repair that keeps some sentences is unchanged", async () => {
    vi.stubEnv("SELF_CHECK_NEVER_BLANK_ENABLED", "true");
    const mixed = { ...reply, content: `Consent forms are signed first (Consent Forms, JBA Policy Manual p.49). ${reply.content}` };
    const settled = await runSelfCheck(mixed, noRepair);
    expect(settled.content).toBe("Consent forms are signed first (Consent Forms, JBA Policy Manual p.49).");
  });

  /*
   * Register rule: the manager's question and the model's reply, all
   * lowercase and in sentence case (names lowercase or Capitalized). On, the
   * reply is never blank in any of them. The citation reader itself only
   * reads "JBA Policy Manual p.N" as written (the citation rule is not
   * touched here), so an all-lowercase reply is not cut at all and goes out
   * as written either way.
   */
  const lower = (text: string) => text.toLowerCase();
  const sentenceNamesLower = (text: string) =>
    text
      .toLowerCase()
      .replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
  const sentenceNamesCapitalized = (text: string) =>
    sentenceNamesLower(text)
      .replace(/\bncr\b/g, "NCR")
      .replace(/\beft\b/g, "EFT")
      .replace(/\bfitzpatrick\b/g, "Fitzpatrick")
      .replace(/\bjba policy manual\b/g, "JBA Policy Manual");

  const registers = [
    ["all lowercase", lower, false],
    ["sentence case, names lowercase", sentenceNamesLower, false],
    ["sentence case, names Capitalized", sentenceNamesCapitalized, true],
  ] as const;

  it.each(registers)("on (%s): the reply is never blank and goes out as the model wrote it", async (_label, recase) => {
    vi.stubEnv("SELF_CHECK_NEVER_BLANK_ENABLED", "true");
    const variant = { ...reply, content: recase(reply.content), question: recase(reply.question ?? "") };
    const settled = await runSelfCheck(variant, noRepair);
    expect(settled.content.trim()).not.toBe("");
    expect(settled.content).toBe(variant.content);
  });

  it.each(registers)("off (%s): blanked only where the citation is read", async (_label, recase, citationRead) => {
    const variant = { ...reply, content: recase(reply.content), question: recase(reply.question ?? "") };
    const settled = await runSelfCheck(variant, noRepair);
    expect(settled.content).toBe(citationRead ? "" : variant.content);
  });

  it.each([
    ["as typed", (text: string) => text],
    ["question all lowercase", lower],
    ["question sentence case, names lowercase", sentenceNamesLower],
  ] as const)("on (%s): a repair that keeps some sentences is unchanged", async (_label, recase) => {
    vi.stubEnv("SELF_CHECK_NEVER_BLANK_ENABLED", "true");
    const mixed = {
      ...reply,
      question: recase(reply.question ?? ""),
      content: `Consent forms are signed first (Consent Forms, JBA Policy Manual p.49). ${sentenceNamesCapitalized(reply.content)}`,
    };
    const settled = await runSelfCheck(mixed, noRepair);
    expect(settled.content).toBe("Consent forms are signed first (Consent Forms, JBA Policy Manual p.49).");
  });
});
