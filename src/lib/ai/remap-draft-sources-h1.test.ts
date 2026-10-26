import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInlineForm, NO_NOTES_WARNING } from "@/features/chat/create-inline-form";
import { draftNotesFromCard, draftNotesFromConversation } from "@/lib/forms/draft-notes";
import type { ChatFormProposal } from "@/types";

import { withRemapDraftSources } from "./remap-draft-sources";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * QA H1, 25 OCT 2026 — A FULL-REMAP CARD'S CREATE DRAFT WAS ALWAYS BLANK
 * ============================================================================
 *
 * Found in the sibling app's production (a replay of a 1-star chat); the same card and Create path here. The card showed the salon, position, date, Verbal, Payroll No and What
 * happened; Create draft filed a form with Observation, Policy and Action Plan
 * empty: "Your draft was created, but there wasn't enough in the conversation
 * … to prefill it." The remap card named no turns (`sourceMessageIds: []`),
 * and the draft is written from exactly the turns it names. The tester's
 * turns, word for word (test names):
 */
const TURN_1 =
  "create a verbal CA for team member Testy Testerson at Test Salon. location. On 10-16-26 Testy was not properly measuring and weighing product. payroll deduct is not applicable";
const TURN_2 = "employee name is Testy Testerson";

const messages = [
  { id: "msg_turn_1", role: "user" as const, content: TURN_1 },
  { id: "msg_card_1", role: "assistant" as const, content: "Here is the Corrective Action Form." },
  { id: "msg_turn_2", role: "user" as const, content: TURN_2 },
];

/* The remap's card, as production stored it: complete, naming no turns. */
const remapCard: ChatFormProposal = {
  proposalId: "card-2",
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
  supportsInlineDraft: true,
  variantKey: null,
  employeeName: "Testy Testerson",
  employeeRole: "Team Member",
  formDate: "2026-10-16",
  payrollDeduct: "no",
  warningLevel: "verbal",
  issue: "On 10-16-26 Testy was not properly measuring and weighing product.",
  priorActions: null,
  locationId: "loc-1",
  locationName: "Test Salon",
  locationResolution: "resolved",
  authorizedLocationIds: ["loc-1"],
  status: "ready",
  sourceMessageIds: [],
} as unknown as ChatFormProposal;

const answered = (proposal: ChatFormProposal): AskResponse =>
  ({ content: "Here is the Corrective Action Form.", citations: [], formProposal: proposal }) as unknown as AskResponse;

const askFor = { history: messages.slice(0, 2), question: TURN_2, questionMessageId: "msg_turn_2" };

afterEach(() => vi.unstubAllEnvs());

describe("part 1 — REMAP_DRAFT_SOURCES_ENABLED: the remap card names this form's turns", () => {
  it("on: the card names both manager turns, and the notes carry turn 1's incident", () => {
    vi.stubEnv("REMAP_DRAFT_SOURCES_ENABLED", "true");
    const card = withRemapDraftSources(answered(remapCard), askFor).formProposal!;
    expect(card.sourceMessageIds).toEqual(["msg_turn_1", "msg_turn_2"]);
    const notes = draftNotesFromConversation(messages, card.sourceMessageIds);
    expect(notes.text).toContain("not properly measuring and weighing product");
  });

  it("off: the card names no turns, as production today", () => {
    expect(withRemapDraftSources(answered(remapCard), askFor).formProposal!.sourceMessageIds).toEqual([]);
  });

  it("a proposal-flow card that already names its turns is left exactly as it is", () => {
    vi.stubEnv("REMAP_DRAFT_SOURCES_ENABLED", "true");
    const proposal = { ...remapCard, sourceMessageIds: ["msg_turn_2"] } as ChatFormProposal;
    const response = answered(proposal);
    expect(withRemapDraftSources(response, askFor)).toBe(response);
  });
});

describe("part 2 — NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED: a draft that would be blank is written from the card", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED", "true"));

  const run = async (proposal: ChatFormProposal) => {
    const posted: { url: string; body: unknown }[] = [];
    const call = (async (url: string, init?: RequestInit) => {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return url.endsWith("/draft") ? { notice: null } : { instance: { id: "inst-1" } };
    }) as Parameters<typeof createInlineForm>[0]["call"];
    const result = await createInlineForm({ proposal, messages, call, onCreated: () => undefined });
    return { result, drafted: posted.find((entry) => entry.url.endsWith("/draft")) };
  };

  it("H1's remap card, no turns named: drafted from the card's lines, not filed blank", async () => {
    const { result, drafted } = await run(remapCard);
    expect(result.draftWarning).toBeNull();
    const notes = (drafted!.body as { notes: string }).notes;
    expect(notes).toContain("What happened: On 10-16-26 Testy was not properly measuring and weighing product.");
    expect(notes).toContain("Type of warning: Verbal");
    expect(notes).toContain("Payroll deduct applicable: No");
  });

  it("a card with no What happened still drafts nothing (unchanged)", async () => {
    const { result, drafted } = await run({ ...remapCard, issue: null } as ChatFormProposal);
    expect(result.draftWarning).toBe(NO_NOTES_WARNING);
    expect(drafted).toBeUndefined();
  });

  it("a card naming usable turns is drafted from those turns, exactly as before", async () => {
    const proposal = { ...remapCard, sourceMessageIds: ["msg_turn_1", "msg_turn_2"] } as ChatFormProposal;
    const { drafted } = await run(proposal);
    expect((drafted!.body as { notes: string }).notes).toBe(
      draftNotesFromConversation(messages, proposal.sourceMessageIds).text,
    );
    expect((drafted!.body as { notes: string }).notes).not.toContain("What happened:");
  });

  it("the card's lines are only the fields the card shows", () => {
    expect(draftNotesFromCard({ ...remapCard, issue: "late" } as ChatFormProposal).text).toBe("");
  });
});

describe("part 2 off: exactly today's behaviour", () => {
  it("a remap card with What happened and no turns still warns and makes no /draft call", async () => {
    const posted: string[] = [];
    const call = (async (url: string) => {
      posted.push(url);
      return url.endsWith("/draft") ? { notice: null } : { instance: { id: "inst-1" } };
    }) as Parameters<typeof createInlineForm>[0]["call"];
    const result = await createInlineForm({ proposal: remapCard, messages, call, onCreated: () => undefined });
    expect(result.draftWarning).toBe(NO_NOTES_WARNING);
    expect(posted.some((url) => url.endsWith("/draft"))).toBe(false);
  });
});
