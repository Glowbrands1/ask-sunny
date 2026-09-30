import { describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import { detectInventoryQuestion } from "@/lib/forms/inventory-question";
import { asksAboutForms, detectTemplateIntent } from "@/lib/forms/template-intent";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * A QUESTION ABOUT FORMS IS ANSWERED; A REQUEST FOR ONE OPENS IT
 * ============================================================================
 *
 * LIVE, 29 September 2026:
 *
 *   "what's the difference between corrective action and coaching form"
 *        → explained (correct)
 *   "difference between corrective action and coaching form"
 *        → opened a Coaching Form and asked for the employee (wrong)
 *
 * The routing matrix below runs every phrasing through the real classifier
 * AND the real chat proposal (`proposeFormForTurn`): null means the turn goes
 * on to normal, cited knowledge retrieval; a proposal means a form workflow.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

function template(key: string, name: string, layoutFamily: string, permission: string, extra: Record<string, unknown> = {}) {
  return {
    id: `tpl-${key}`,
    key,
    name,
    shortName: name,
    description: name,
    layoutFamily,
    requiredPermission: permission,
    active: true,
    displayOrder: 1,
    currentVersion: { id: `v-${key}`, status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...extra,
  };
}

const LIBRARY = [
  template("coaching", "Coaching Form", "coaching", "create_coaching_form"),
  template("dpoa", "Corrective Action Form", "corrective", "create_corrective_action", {
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
  template("stc-exit", "Exit Form", "exit", "create_exit_form"),
];

async function route(question: string) {
  const { proposeFormForTurn } = await import("./form-proposal");
  return proposeFormForTurn({
    history: [],
    question,
    questionMessageId: "msg-1",
    actor: { role: "salon_director" as never, scope: SALON },
    summaries: LIBRARY as never,
    today: "2026-09-29",
  } as never);
}

const INFORMATIONAL = [
  "difference between corrective action and coaching form",
  "difference between CA and coaching",
  "whats the difference between corrective action and coaching form",
  "corrective action vs coaching",
  "CA vs coaching",
  "CA vs coaching form",
  "coaching form versus corrective action form",
  "compare coaching and corrective action",
  "coaching form or corrective action?",
  "when do I use CA",
  "when do I use CA instead of coaching",
  "when should I use CA",
  "when should I use an exit form",
  "explain coaching form",
  "explain corrective action and coaching",
  "which form should I use for attendance",
  "which form is for policy violations",
  "what is a corrective action",
  "tell me about the exit form",
];

const CREATION: [string, string][] = [
  ["CA for Paulyne Test", "dpoa"],
  ["corrective action for Paulyne Test", "dpoa"],
  ["coaching for Paulyne Test", "coaching"],
  ["exit for Paulyne Test", "stc-exit"],
  ["create a corrective action for Paulyne", "dpoa"],
  ["make a coaching form for John", "coaching"],
  ["open an exit form for Sarah", "stc-exit"],
  ["exit for John Smith", "stc-exit"],
  ["coaching form for Jane", "coaching"],
];

describe("informational questions stay in normal chat — with or without 'what'", () => {
  it.each(INFORMATIONAL)("%s", async (question) => {
    expect(asksAboutForms(question)).toBe(true);
    const intent = detectTemplateIntent(question);
    expect(intent.kind === "none" || (intent.kind === "corrective_action" && !intent.requestedCreation)).toBe(true);
    /* No proposal, no form card, no library listing: the turn goes to cited knowledge retrieval. */
    expect(await route(question)).toBeNull();
    expect(detectInventoryQuestion(question)).toEqual({ kind: "none" });
  });
});

describe("creation requests open the right form — shorthand included, no verb required", () => {
  it.each(CREATION)("%s → %s", async (question, key) => {
    expect(asksAboutForms(question)).toBe(false);
    const response = await route(question);
    expect(response).not.toBeNull();
    expect(response!.formProposal?.templateKey).toBe(key);
  });

  it("'corrective action for employee test for attendance' — a subject, then a reason — requests the form", () => {
    expect(detectTemplateIntent("corrective action for employee test for attendance")).toEqual({ kind: "corrective_action", requestedCreation: true });
    /* A topic alone is still a question about the process. */
    expect(detectTemplateIntent("corrective action for repeated lateness")).toEqual({ kind: "corrective_action", requestedCreation: false });
  });
});

describe("library questions still answer from the library", () => {
  it.each([
    ["which forms do we have?", "list"],
    ["do we have a coaching form?", "availability"],
  ])("%s → %s", (question, kind) => {
    expect(detectInventoryQuestion(question).kind).toBe(kind);
  });
});
