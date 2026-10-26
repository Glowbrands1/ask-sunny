import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readReopenRequest } from "./reopen-request";

/**
 * REOPEN_REQUEST_VERB_ONLY_ENABLED (Sunny tester, round 3, 26 Oct 2026,
 * conv_mvokdg0w2i6d1hu, 3 of 3 tries): "follow up coaching form for devon
 * harlan must see behavior red light promo check-ins" was read as "open an
 * existing form" ("see" in the account was the show verb) and answered "I
 * couldn't find a Follow-Up Coaching Form for devon harlan on file that you
 * can open…". The manager asked to CREATE one: the account is right there.
 * The wording is the tester's; the name is invented. Lowercase, sentence case
 * and ALL CAPS.
 */

const TESTER = "follow up coaching form for devon harlan must see behavior red light promo check-ins";
const TWINS = [
  TESTER,
  "Follow up coaching form for devon harlan must see behavior red light promo check-ins",
  "Follow up coaching form for Devon Harlan must see behavior red light promo check-ins",
  TESTER.toUpperCase(),
];

/** Asking for the form on file still opens it, flag on or off. */
const REOPENS = [
  "show me the follow up coaching form for devon harlan",
  "Show me the follow up coaching form for Devon Harlan",
  "edit the follow up coaching form for devon harlan",
  "reopen the follow up coaching form for Devon Harlan",
  "change exit for lacey morrow",
  "show draft of exit",
];

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

/* No Follow-Up Coaching Form is on file for this employee; another form is. */
const OTHER_CHAT_DRAFT: Row = {
  id: "ca-other-chat",
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
  employeeName: "Devon Harlan",
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

describe("REOPEN_REQUEST_VERB_ONLY_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("REOPEN_REQUEST_VERB_ONLY_ENABLED", "true"));

  it.each(TWINS)("%s asks for a new form, never one on file", async (turn) => {
    expect(readReopenRequest(turn)).toBeNull();
    expect(await ask(turn)).toBeNull();
    expect(state.listed).toBe(0);
  });

  it.each(REOPENS)("%s still opens the form on file", (turn) => {
    const on = readReopenRequest(turn);
    vi.stubEnv("REOPEN_REQUEST_VERB_ONLY_ENABLED", "");
    expect(on).not.toBeNull();
    expect(on).toEqual(readReopenRequest(turn));
  });
});

describe("REOPEN_REQUEST_VERB_ONLY_ENABLED off", () => {
  it("the tester's turn is read as a reopen and answered \"couldn't find … on file\" (the reported bug)", async () => {
    expect(readReopenRequest(TESTER)).toEqual({ mode: "show", templateKey: "follow-up-coaching", asksChange: false });
    const reply = await ask(TESTER);
    expect(reply?.content ?? "").toMatch(/couldn.t find a .*devon harlan.* on file/i);
  });
});
