import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { caPolicyProposalLine, groundConductPolicy, readCaPolicy } from "./ca-policy";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * PLAIN CONDUCT WORDING IS THE STANDARDS OF CONDUCT
 * (POLICY_CONDUCT_WORDING_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026, in the managers' exact words (names invented):
 *
 *   T4  "she didn't complete required policy acknowledgments during
 *       onboarding" / "failed to have a new hire complete required policy
 *       acknowledgements in woven" — must resolve to Standards of Conduct
 *       (p.12/13) with no help.
 *   T2  "refused to do what I asked her to do and walked off", "talked back",
 *       "disrespectful to her manager".
 *   J1  "talking negatively about co-workers", "gossip", "talking behind her
 *       back" — Standards of Conduct p.12, never Sexual and Other Forms of
 *       Harassment p.9 unless the manager used a harassment word.
 *
 * Each case fails with the flag off (main reads no policy, or the model's
 * harassment heading stands) and passes with it on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);

const ACCOUNTS = [
  "Create a written corrective action for Marlo Quint, Salon Director. She didn't complete required policy acknowledgments during onboarding.",
  "create ca for Marlo Quint, Salon Director. Marlo failed to have a new hire complete required policy acknowledgements in woven during onboarding on 9-28-26.",
  "Marlo Quint refused to do what I asked her to do and walked off.",
  "Marlo Quint talked back when I gave her the closing checklist.",
  "Marlo Quint was disrespectful to her manager on 10-12-26.",
  "Marlo Quint has been talking negatively about co-workers.",
  "Marlo Quint keeps starting gossip in the salon.",
  "Marlo Quint was talking behind her back to the rest of the team.",
] as const;

afterEach(() => vi.unstubAllEnvs());
// Flag-off pins hold whatever the environment has on; flag-on tests set it.
beforeEach(() => vi.stubEnv("POLICY_CONDUCT_WORDING_ENABLED", ""));

function on() {
  vi.stubEnv("POLICY_CONDUCT_WORDING_ENABLED", "true");
}

describe("flag off: main's reading, unchanged", () => {
  it.each(ACCOUNTS)("reads no Standards of Conduct for %s", (text) => {
    // The -ements spelling had its own hook on main; the rest read nothing.
    if (/acknowledgements/.test(text)) return;
    expect(readCaPolicy(text).suggestion).toBeNull();
  });
});

describe("flag on: the account resolves Standards of Conduct with no help", () => {
  it.each(ACCOUNTS)("%s", (text) => {
    on();
    const reading = readCaPolicy(text);
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(reading.ambiguous).toBeNull();
    expect(caPolicyProposalLine(reading)).toContain("**Standards of Conduct**");
    const grounded = groundConductPolicy({ reading, chunks: CHUNKS });
    expect(grounded.ok).toBe(true);
    expect(accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`)).toEqual([
      "Standards of Conduct p.12",
    ]);
  });

  it("grounds disrespect on the manual's own line, not the catch-all", () => {
    on();
    const grounded = groundConductPolicy({ reading: readCaPolicy(ACCOUNTS[4]), chunks: CHUNKS });
    expect(grounded.ok && grounded.anchor).toMatch(/disrespect for a manager or other Employees/);
  });
});

describe("J1 lock: gossip is NOT harassment", () => {
  const HARASSMENT = "Sexual and Other Forms of Harassment";
  const gossip = ACCOUNTS.slice(5);

  it.each(gossip)("the card cites p.12 and never p.9, whatever the model named: %s", (notes) => {
    on();
    const citations = formTurnCitations({
      notes,
      chunks: CHUNKS,
      documentId: "manual",
      documentTitle: "JBA Policy Manual",
      modelHeading: HARASSMENT,
    });
    expect(citations.map((citation) => citation.locator)).toEqual(["Page 12"]);
    expect(citations.some((citation) => citation.excerpt.startsWith(HARASSMENT))).toBe(false);
  });

  it("with the flag off the model's harassment heading stood (the bug)", () => {
    const citations = formTurnCitations({
      notes: gossip[0]!,
      chunks: CHUNKS,
      documentId: "manual",
      documentTitle: "JBA Policy Manual",
      modelHeading: HARASSMENT,
    });
    expect(citations.map((citation) => citation.locator)).toEqual(["Page 9"]);
  });

  it("a manager's harassment word leaves the reading to the existing path", () => {
    on();
    const reading = readCaPolicy("Marlo Quint was gossiping and making sexual comments about a co-worker.");
    expect(reading.topics).not.toContain("disrespect");
  });
});

describe("what the plain wording does not read", () => {
  it.each([
    "Marlo Quint completed her policy acknowledgments in woven on 10-1-26.",
    "Marlo Quint asked me about the policy acknowledgment report.",
    "Marlo Quint talked to me about her schedule.",
  ])("%s", (text) => {
    on();
    expect(readCaPolicy(text).topics).toEqual([]);
  });
});

/*
 * HOW MANAGERS TYPE (Pau, 26 Oct 2026): every wording also in all lowercase and
 * in sentence case, names lowercase or capitalised, plus the terse, rude
 * register from the chat history. The reading is the same in each.
 */
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

describe("flag on: the same Standards of Conduct reading in every register", () => {
  const REGISTER = [
    ...ACCOUNTS.flatMap((text) => [lower(text), sentence(text)]),
    "didnt complete the policy acknowledgments",
    "Didnt complete the policy acknowledgments",
    "marlo failed to have new hire do policy acknowledgements in woven",
    "talking bad about coworkers",
    "Talking bad about coworkers",
    "shes always gossiping",
    "she refused to do what i asked her to do and walked off",
    "She talked back to me again",
    "was disrespectful to her manager",
  ];

  it.each(REGISTER)("%s", (text) => {
    on();
    expect(readCaPolicy(text).suggestion).toBe("standards_of_conduct");
    expect(accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`)).toEqual([
      "Standards of Conduct p.12",
    ]);
  });

  it.each(ACCOUNTS)("never harassment in lowercase or sentence case: %s", (text) => {
    on();
    for (const typed of [lower(text), sentence(text)]) {
      expect(accountManualSections(typed, CHUNKS).some((section) => /harassment/i.test(section.heading))).toBe(false);
    }
  });
});

/*
 * QA-7, 26 Oct 2026 (names invented): a conduct the manager denies is not one,
 * and "one did, the other did not" names no one. Lowercase, sentence case and
 * CAPS.
 */
describe("flag on: a denied conduct reads no Standards of Conduct", () => {
  const registers = (text: string) => [lower(text), sentence(text), text.toUpperCase()];
  const DENIED = [
    "she did not talk back",
    "she never gossips",
    "she was not disrespectful to her manager",
    "tom gossips but dana does not",
    "Marlo Quint didn't talk back when I gave her the closing checklist.",
    "Marlo Quint has never been rude to a customer.",
  ].flatMap(registers);

  it.each(DENIED)("%s", (text) => {
    on();
    expect(readCaPolicy(text).topics).not.toContain("disrespect");
    expect(accountManualSections(text, CHUNKS).map((section) => section.heading)).not.toContain("Standards of Conduct");
  });

  it.each(
    [
      "she was not on time and she talked back",
      "she did not clock in, then talked back to her manager",
      "Marlo Quint was disrespectful to her manager, not to the customers.",
    ].flatMap(registers),
  )("what is still said is still read: %s", (text) => {
    on();
    expect(readCaPolicy(text).topics).toContain("disrespect");
  });

  it.each(DENIED)("flag off: reads no plain-wording conduct: %s", (text) => {
    expect(readCaPolicy(text).topics).not.toContain("disrespect");
  });
});
