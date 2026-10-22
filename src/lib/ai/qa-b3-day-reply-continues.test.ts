import { describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 22 OCTOBER 2026 — B3: "today" ENDED THE OPEN INTAKE
 * ============================================================================
 *
 * Ask Sunny QA's conversation, typed exactly:
 *
 *   "create coaching form for pat rivera, late 3 times this week"
 *   "i already told you"
 *   "today"
 *
 * The first two turns kept the Coaching card for Pat Rivera; the third named
 * no calendar date, so it left the intake for a grounded answer and a form
 * picker, and the card had to be asked for again. A reply that is only a day
 * now carries the open form forward; a question that mentions today, or a day
 * with no form open, still does not.
 */

const fixtures = vi.hoisted(() => {
  const row = (first: string, last: string, salonIds: string[]) => ({
    id: `emp-${first}-${last}`.toLowerCase(),
    firstName: first,
    lastName: last,
    preferredFirstName: null,
    employmentStatus: "active",
    salonIds,
  });
  return {
    rows: [
      row("Pat", "Rivera", ["loc-0310"]),
    ],
  };
});

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
  return {
    ...original,
    readDirectoryRoster: async () => fixtures.rows,
    loadScopedRoster: async (scope: AccessScope | null) => original.scopeRoster(fixtures.rows, scope),
  };
});

const MANAGER: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };

/** The real library, shaped as `listTemplateSummaries` returns it. */
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
function id(): string {
  counter += 1;
  return `msg-${counter}`;
}

/** Sends each turn the way the chat screen does; returns the latest assistant turn (null: left the forms path). */
async function converse(...turns: string[]): Promise<ChatMessage | null> {
  const { proposeFormForTurn } = await import("./form-proposal");
  const thread: ChatMessage[] = [];
  let last: ChatMessage | null = null;
  for (const question of turns) {
    const history = [...thread];
    const user: ChatMessage = { id: id(), role: "user", content: question, createdAt: "2026-10-22T12:00:00Z" };
    thread.push(user);
    const answer = await proposeFormForTurn({
      history,
      question,
      questionMessageId: user.id,
      actor: { role: "salon_director" as never, scope: MANAGER },
      continueTemplateKey: continuationFor(history)?.templateKey,
      summaries: LIBRARY as never,
      today: "2026-10-22",
    });
    last = answer?.formProposal
      ? { id: id(), role: "assistant", content: answer.content, createdAt: "2026-10-22T12:00:00Z", formProposal: answer.formProposal }
      : null;
    thread.push(last ?? { id: id(), role: "assistant", content: "(grounded advice answer)", createdAt: "2026-10-22T12:00:00Z" });
  }
  return last;
}

const REQUEST = "create coaching form for pat rivera, late 3 times this week";

describe("QA B3 — a day on its own answers the open form", () => {
  it("\"today\" after \"i already told you\" keeps the Coaching card for Pat Rivera (QA's exact turns)", async () => {
    const first = await converse(REQUEST);
    const reply = await converse(REQUEST, "i already told you", "today");
    expect(reply?.formProposal?.templateKey).toBe("coaching");
    expect(reply?.formProposal?.employeeName).toMatch(/^pat rivera$/i);
    // The salon is whatever the card already showed (this harness resolves none from the request).
    expect(reply?.formProposal?.locationId).toBe(first?.formProposal?.locationId);
  });

  it.each(["today", "yesterday", "it was yesterday", "on Monday", "this morning", "Today."])(
    "\"%s\" straight after the card keeps it",
    async (day) => {
      const reply = await converse(REQUEST, day);
      expect(reply?.formProposal?.templateKey).toBe("coaching");
      expect(reply?.formProposal?.employeeName).toMatch(/^pat rivera$/i);
    },
  );

  it("a question about today still leaves the intake", async () => {
    expect(await converse(REQUEST, "what is the attendance policy today?")).toBeNull();
  });

  it("a day with no form open starts nothing", async () => {
    expect(await converse("today")).toBeNull();
  });
});
