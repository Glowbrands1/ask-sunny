import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readReopenRequest } from "./reopen-request";

/**
 * ============================================================================
 * QA B22, 25 OCT 2026 — "NO CALL NO SHOW" IS NOT "SHOW ME THE FORM"
 * ============================================================================
 *
 * In a NEW chat, a request for a new corrective action put another chat's
 * draft back in the thread ("The Corrective Action Form for Test Employee is
 * still a draft, so it's open to edit.", an older draft for a different
 * incident and date). The reopen reader took "show" in "no call no show" as
 * the verb and "corrective action" as the form. The turns, word for word,
 * with the names swapped for invented ones:
 *
 *   B22-1  "Write up Test Employee, Tanning Consultant, at Test Salon, for no call no show on 10/22."
 *   cross  "Draft a corrective action for Test Employee at the Test Salon. She was a no call no show today."
 *
 * REOPEN_VERB_GUARD_ENABLED: neither is a reopen, so the proposal flow makes
 * a new card. Asking to see or change the form on file still opens it.
 */

const B22_1 = "Write up Test Employee, Tanning Consultant, at Test Salon, for no call no show on 10/22.";
const CROSS = "Draft a corrective action for Test Employee at the Test Salon. She was a no call no show today.";

type Row = {
  id: string;
  templateKey: string;
  templateName: string;
  employeeName: string;
  status: "draft" | "finalized" | "revised";
  createdAt: string;
  revisesInstanceId: string | null;
  events: { kind: string; detail: Record<string, unknown> }[];
};

const state = vi.hoisted(() => ({ rows: [] as Row[], listed: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("./access", () => ({
  authorizeForms: async () => ({ id: "user-1", role: "salon_director", verified: true, visibility: null }),
}));
vi.mock("./instance-scope", () => ({
  authorizeInstance: async (_request: Request, id: string) => {
    const found = state.rows.find((entry) => entry.id === id);
    if (!found) throw new Error("No such form.");
    return { actor: { id: "user-1" }, loaded: { instance: found, events: found.events } };
  },
  instanceListFilterFor: () => undefined,
  visibleInstances: (_actor: unknown, rows: Row[]) => rows,
}));
vi.mock("./instances", () => ({
  listInstances: async () => {
    state.listed += 1;
    return state.rows;
  },
  findOpenRevision: async () => null,
  reviseInstance: async () => {
    throw new Error("nothing is revised here");
  },
}));
vi.mock("./chat-correction", () => ({ correctActiveForm: async () => null }));
vi.mock("./chat-policy-change", () => ({ changeActiveFormPolicy: async () => null }));
vi.mock("./chat-revision", () => ({ reviseActiveForm: async () => null }));

const { reopenRequestedForm } = await import("./chat-reopen");

/* Another chat's open draft: same employee, a tardiness write-up dated 20 Oct. */
const OTHER_CHAT_DRAFT: Row = {
  id: "ca-other-chat",
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
  employeeName: "Test Employee",
  status: "draft",
  createdAt: "2026-10-25T16:33:00Z",
  revisesInstanceId: null,
  events: [],
};

const ask = (question: string) =>
  reopenRequestedForm({
    request: new Request("http://localhost/api/chat"),
    question,
    history: [],
    today: "2026-10-25",
  });

beforeEach(() => {
  state.rows = [{ ...OTHER_CHAT_DRAFT }];
  state.listed = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("REOPEN_VERB_GUARD_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("REOPEN_VERB_GUARD_ENABLED", "true"));

  it.each([
    ["B22-1", B22_1],
    ["cross-chat", CROSS],
  ])("%s is a new form, never the other chat's draft", async (_label, turn) => {
    expect(readReopenRequest(turn)).toBeNull();
    expect(await ask(turn)).toBeNull();
    expect(state.listed).toBe(0);
  });

  it.each([
    "she didn't show up for her shift, the corrective action needs a date",
    "write up a corrective action for Test Employee",
    "I need a corrective action for Test Employee, she never showed up",
    "Test Employee was a no-show, corrective action please",
  ])("%s is not a reopen", (turn) => {
    expect(readReopenRequest(turn)).toBeNull();
  });

  it.each([
    "I need you to draft a corrective action for Test Employee, she was a no-call/no-show",
    "please write up Test Employee, no call or no show yesterday",
    "let's do a corrective action for Test Employee, she showed up late",
  ])("%s is a new form", (turn) => {
    expect(readReopenRequest(turn)).toBeNull();
  });

  it.each([
    "show me the write up for Test Employee",
    "open the draft of the CA for Test Employee",
    "bring back the write-up for Test Employee",
  ])("%s reads exactly as with the guard off (a noun, not a request)", (turn) => {
    const on = readReopenRequest(turn);
    vi.stubEnv("REOPEN_VERB_GUARD_ENABLED", "");
    expect(on).toEqual(readReopenRequest(turn));
  });

  it.each([
    "I need a copy of the corrective action for Test Employee",
    "do an edit of the CA for Test Employee",
    "I need a copy of the write up for Test Employee",
  ])("%s reads exactly as with the guard off (QA review: not a document request)", (turn) => {
    const on = readReopenRequest(turn);
    vi.stubEnv("REOPEN_VERB_GUARD_ENABLED", "");
    expect(on).toEqual(readReopenRequest(turn));
  });

  it.each(["I need a corrective action for Test Employee", "do a verbal write up for Test Employee"])(
    "%s is a document request",
    (turn) => {
      expect(readReopenRequest(turn)).toBeNull();
    },
  );

  it("a real ask to see the form still reopens when the turn also has a no-show", async () => {
    const turn = "show me the CA for Test Employee, she was a no call no show";
    expect(readReopenRequest(turn)).toEqual({ mode: "show", templateKey: "dpoa", asksChange: false });
    expect((await ask(turn))!.formOpened!.instanceId).toBe("ca-other-chat");
  });

  it("asking to see the corrective action on file still opens it", async () => {
    expect(readReopenRequest("show me the corrective action for Test Employee")).toEqual({
      mode: "show",
      templateKey: "dpoa",
      asksChange: false,
    });
    const response = await ask("show me the corrective action for Test Employee");
    expect(response!.formOpened!.instanceId).toBe("ca-other-chat");
  });

  it("asking to change it still opens it to edit", () => {
    expect(readReopenRequest("change the corrective action for Test Employee")).toMatchObject({
      mode: "edit",
      templateKey: "dpoa",
    });
  });
});

describe("REOPEN_VERB_GUARD_ENABLED off: as production today", () => {
  it.each([
    ["B22-1", B22_1],
    ["cross-chat", CROSS],
  ])("%s reads 'show' as the verb and opens the other chat's draft", async (_label, turn) => {
    expect(readReopenRequest(turn)).toEqual({ mode: "show", templateKey: "dpoa", asksChange: false });
    const response = await ask(turn);
    expect(response!.content).toContain("is still a draft, so it's open to edit");
    expect(response!.formOpened!.instanceId).toBe("ca-other-chat");
  });
});
