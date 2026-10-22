import { describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA F-05, 22 OCT 2026 — TIMES, PRICES AND QUANTITIES ARE NOT SALONS
 * ============================================================================
 *
 * A bare number after "at" was read as a salon number or a Google store code,
 * and a salon the manager names outranks the employee's own — so a Salon
 * Director covering two salons who wrote "she got here at 410 today" had the
 * form filed at salon 0410 without ever naming it. Played through the real
 * proposal with the continuation key the browser sends.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return { ...original, loadScopedRoster: async () => [] };
});

/** A Salon Director covering NE Lincoln 27th Street (0310) and salon 0410. */
const TWO_SALONS: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0410"] };

const LIBRARY = TEMPLATE_SEEDS.map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

let counter = 0;
async function converse(...turns: string[]) {
  const { proposeFormForTurn } = await import("./form-proposal");
  const thread: ChatMessage[] = [];
  let last: Awaited<ReturnType<typeof proposeFormForTurn>> = null;
  for (const question of turns) {
    const history = [...thread];
    const user: ChatMessage = { id: `m${(counter += 1)}`, role: "user", content: question, createdAt: "2026-10-21T12:00:00Z" };
    thread.push(user);
    last = await proposeFormForTurn({
      history,
      question,
      questionMessageId: user.id,
      actor: { role: "salon_director" as never, scope: TWO_SALONS },
      continueTemplateKey: continuationFor(history)?.templateKey,
      summaries: LIBRARY as never,
      today: "2026-10-21",
    });
    thread.push({
      id: `m${(counter += 1)}`,
      role: "assistant",
      content: last?.content ?? "(advice)",
      createdAt: "2026-10-21T12:00:00Z",
      ...(last?.formProposal ? { formProposal: last.formProposal } : {}),
    } as ChatMessage);
  }
  return last!;
}

describe("negative: a time, a price or a quantity never files a salon", () => {
  it.each([
    "coaching form for Jane Doe, she got here at 410 today",
    "coaching form for Jane Doe, she sold a package at 140",
    "coaching form for Jane Doe, she rang up a sale at 231 dollars",
    "coaching form for Jane Doe, we met at 409 for lunch",
    "coaching form for Jane Doe, she stayed at 410 for an hour",
  ])("%s", async (question) => {
    const last = await converse(question);
    expect(last.formProposal?.employeeName).toBe("Jane Doe");
    expect(last.formProposal?.locationId).toBeNull();
    // Two salons and none named: the manager is asked, among their own two.
    expect(last.formProposal?.locationResolution).toBe("needs_selection");
    expect([...(last.formProposal?.authorizedLocationIds ?? [])].sort()).toEqual(["loc-0310", "loc-0410"]);
  });
});

describe("positive: a salon the manager names by number", () => {
  it.each([
    ["coaching form for Jane Doe at salon 0410", "loc-0410"],
    ["coaching form for Jane Doe, salon 410", "loc-0410"],
    ["coaching form for Jane Doe at 0410", "loc-0410"],
    ["coaching form for Jane Doe #0310", "loc-0310"],
  ])("%s", async (question, salon) => {
    const last = await converse(question);
    expect(last.formProposal?.locationId).toBe(salon);
  });
});

describe("ambiguous: a number that is two salons' is never guessed", () => {
  it("salon 306 (Wornall's number, KS Manhattan's store code) names neither", async () => {
    const last = await converse("coaching form for Jane Doe at salon 306");
    expect(last.formProposal?.locationId).toBeNull();
  });
});

describe("multi-turn: the account's times do not move the form, the salon does", () => {
  it("keeps asking through a time, then takes the salon the manager names", async () => {
    const opened = await converse("coaching form for Jane Doe");
    expect(opened.formProposal?.locationId).toBeNull();

    const timed = await converse("coaching form for Jane Doe", "she got here at 410 today, again");
    expect(timed.formProposal?.employeeName).toBe("Jane Doe");
    expect(timed.formProposal?.locationId).toBeNull();

    const named = await converse("coaching form for Jane Doe", "she got here at 410 today, again", "salon 0410");
    expect(named.formProposal?.employeeName).toBe("Jane Doe");
    expect(named.formProposal?.locationId).toBe("loc-0410");
  });
});

/*
 * ============================================================================
 * OWNER DECISION, 22 OCT 2026: 306, 307 AND 314 ARE ASKED, NEVER GUESSED
 * ============================================================================
 *
 * "For ambiguous salon numbers 306/307/314, ask the manager to clarify. Never
 * guess." Each is one salon's number and ANOTHER salon's Google store code
 * (306: Wornall 0306 or KS Manhattan 0462; 307: Grand Island 0307 or KS
 * Shawnee Mission Pkwy 0463; 314: Omaha 144th and Center 0314 or KS Lawrence
 * 0468). A salon-level manager with several salons was already asked; an
 * account that covers every salon had the number dropped without a word and
 * got a ready card naming no salon. It is now asked, offering just the two.
 */
describe("owner decision: 306/307/314 are asked, never guessed (an account covering every salon)", () => {
  const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
  async function propose(question: string) {
    const { proposeFormForTurn } = await import("./form-proposal");
    const answer = await proposeFormForTurn({
      history: [],
      question,
      questionMessageId: `m${(counter += 1)}`,
      actor: { role: "admin" as never, scope: GLOBAL },
      summaries: LIBRARY as never,
      today: "2026-10-22",
    });
    return answer!.formProposal!;
  }

  it.each([
    ["coaching form for Jane Doe at salon 306", ["loc-0306", "loc-0462"]],
    ["coaching form for Jane Doe at store 306", ["loc-0306", "loc-0462"]],
    ["coaching form for Jane Doe salon 307", ["loc-0307", "loc-0463"]],
    ["coaching form for Jane Doe store 307", ["loc-0307", "loc-0463"]],
    ["coaching form for Jane Doe #314", ["loc-0314", "loc-0468"]],
    ["coaching form for Jane Doe at location 314", ["loc-0314", "loc-0468"]],
  ])("%s → no salon filled in; asks between the two", async (question, both) => {
    const proposal = await propose(question);
    expect(proposal.locationId).toBeNull();
    expect(proposal.status).toBe("needs_location");
    expect(proposal.locationResolution).toBe("needs_selection");
    expect([...proposal.authorizedLocationIds].sort()).toEqual(both);
  });

  it.each([
    ["coaching form for Jane Doe at salon 0307", "loc-0307"],
    ["coaching form for Jane Doe at store 373", "loc-0476"],
  ])("an unambiguous number is still filled in: %s", async (question, salon) => {
    expect((await propose(question)).locationId).toBe(salon);
  });

  it.each([
    ["0307", "loc-0307"],
    ["grand island", "loc-0307"],
    ["salon 0463", "loc-0463"],
  ])("answering the question with %s fills in that salon", async (reply, salon) => {
    const { proposeFormForTurn } = await import("./form-proposal");
    const ask = "coaching form for Jane Doe salon 307";
    const asked = await propose(ask);
    const history: ChatMessage[] = [
      { id: "q1", role: "user", content: ask, createdAt: "2026-10-22T12:00:00Z" },
      { id: "a1", role: "assistant", content: "Which salon is this about?", createdAt: "2026-10-22T12:00:00Z", formProposal: asked } as ChatMessage,
    ];
    const answer = await proposeFormForTurn({
      history,
      question: reply,
      questionMessageId: "q2",
      actor: { role: "admin" as never, scope: GLOBAL },
      continueTemplateKey: continuationFor(history)?.templateKey,
      summaries: LIBRARY as never,
      today: "2026-10-22",
    });
    expect(answer?.formProposal?.employeeName).toBe("Jane Doe");
    expect(answer?.formProposal?.locationId).toBe(salon);
  });

  it("no number at all: the form names no salon, as before", async () => {
    const proposal = await propose("coaching form for Jane Doe");
    expect(proposal.locationResolution).toBe("not_applicable");
    expect(proposal.status).toBe("ready");
  });
});
