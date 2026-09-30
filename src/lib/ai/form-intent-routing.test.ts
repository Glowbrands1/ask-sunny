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

/*
 * ============================================================================
 * CAPITALS ARE NEVER EVIDENCE
 * ============================================================================
 *
 * Managers type in lower case. "ca for paulyne test" means exactly what "CA
 * for Paulyne Test" means, and "difference between CA and coaching" is a
 * question in any case. Every phrasing below is routed in its typed form and
 * in lower case, UPPER case, Title Case and a mixed variant; all must agree —
 * on the intent, on whether a form opens, which one, and who it is for.
 */
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const mixed = (s: string) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
const VARIANTS = (s: string) => [s, s.toLowerCase(), s.toUpperCase(), titleCase(s.toLowerCase()), mixed(s)];

async function reading(question: string) {
  const response = await route(question);
  const proposal = response?.formProposal as { templateKey?: string; employeeName?: string | null } | undefined;
  return {
    intent: JSON.stringify(detectTemplateIntent(question)),
    informational: asksAboutForms(question),
    inventory: detectInventoryQuestion(question).kind,
    form: proposal?.templateKey ?? null,
    employee: proposal?.employeeName ? proposal.employeeName.toLowerCase() : null,
  };
}

describe("lower-case, upper-case and mixed-case input route identically", () => {
  it.each([
    ["CA for Paulyne Test", "dpoa"],
    ["ca for paulyne test", "dpoa"],
    ["corrective action for paulyne test", "dpoa"],
    ["coaching for paulyne test", "coaching"],
    ["exit for paulyne test", "stc-exit"],
    ["coaching paulyne test", "coaching"],
    ["coaching form for jane", "coaching"],
  ])("creation: %s → %s, with the employee recognised, in every case", async (question, key) => {
    const expected = await reading(question);
    expect(expected.form).toBe(key);
    expect(expected.employee).not.toBeNull();
    for (const variant of VARIANTS(question)) expect(await reading(variant), variant).toEqual(expected);
  });

  it.each([
    "difference between corrective action and coaching form",
    "corrective action vs coaching",
    "which form should i use for attendance",
    "explain coaching form",
    "when should i use ca",
  ])("question: %s stays in normal chat, in every case", async (question) => {
    for (const variant of VARIANTS(question)) {
      const r = await reading(variant);
      expect(r.form, variant).toBeNull();
      expect(r.informational, variant).toBe(true);
      expect(r.inventory, variant).toBe("none");
    }
  });

  it("'do we have a coaching form?' is answered from the library in every case, never opened", async () => {
    for (const variant of VARIANTS("do we have a coaching form?")) {
      /* Chat answers an availability question from the library before any proposal is considered. */
      expect(detectInventoryQuestion(variant).kind, variant).toBe("availability");
    }
  });

  it.each([
    "when can we do a coaching form for Jane",
    "tell me about the exit form for Sarah Lee",
    "coaching dana moss, she was late today",
  ])("a person named mid-sentence counts the same in any case: %s", async (question) => {
    const expected = await reading(question);
    for (const variant of VARIANTS(question)) expect(await reading(variant), variant).toEqual(expected);
  });

  it("a capitalised phrase is not a name: 'Coaching Went Well' names nobody, like 'coaching went well'", async () => {
    for (const variant of VARIANTS("coaching went well")) expect(await reading(variant), variant).toMatchObject({ form: null });
  });

  it("the router reads no capitals: no upper-case character class in the intent source", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../forms/template-intent.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\[A-Z\]|\[A-Z[a-z]|\\p\{Lu\}|toUpperCase\(\)\s*===|=== *[a-z]+\.toUpperCase/);
  });
});
