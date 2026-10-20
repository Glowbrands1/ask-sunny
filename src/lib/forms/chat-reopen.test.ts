import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Change exit for ashley rogers" with no form in the conversation: the form
 * on file is found among the ones this actor may see and put in the thread —
 * a finalized one as a new draft of it — and nothing new is ever created.
 */

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

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  revised: [] as string[],
  listed: 0,
  corrected: [] as string[],
  correction: null as null | { content: string; formUpdate?: { instanceId: string; updated: string[] } },
}));

const row = (overrides: Partial<Row>): Row => ({
  id: "exit-1",
  templateKey: "stc-exit",
  templateName: "Resignation/Exit Form",
  employeeName: "Ashley Rogers",
  status: "finalized",
  createdAt: "2026-10-01T12:00:00Z",
  revisesInstanceId: null,
  events: [],
  ...overrides,
});

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
  reviseInstance: async (id: string) => {
    state.revised.push(id);
    const original = state.rows.find((entry) => entry.id === id)!;
    original.status = "revised";
    const revision = row({
      id: `${id}-rev`,
      status: "draft",
      revisesInstanceId: id,
      createdAt: "2026-10-20T12:00:00Z",
    });
    state.rows.push(revision);
    return revision;
  },
}));

vi.mock("./chat-correction", () => ({
  correctActiveForm: async (input: { instanceId: string }) => {
    state.corrected.push(input.instanceId);
    return state.correction
      ? { citations: [], coverage: "not_applicable", recommendedVideoIds: [], ...state.correction }
      : null;
  },
}));
vi.mock("./chat-revision", () => ({ reviseActiveForm: async () => null }));

const { reopenRequestedForm } = await import("./chat-reopen");

const ask = (question: string, activeInstanceId?: string) =>
  reopenRequestedForm({
    request: new Request("http://localhost/api/chat"),
    question,
    history: [],
    today: "2026-10-20",
    activeInstanceId,
  });

beforeEach(() => {
  state.rows = [row({})];
  state.revised = [];
  state.listed = 0;
  state.corrected = [];
  state.correction = null;
});

describe("bringing a form on file back into the conversation", () => {
  it("opens a finalized exit form as a new draft, in the thread", async () => {
    const response = await ask("change exit for ashley rogers");
    expect(state.revised).toEqual(["exit-1"]);
    expect(response!.formOpened).toEqual({
      instanceId: "exit-1-rev",
      templateName: "Resignation/Exit Form",
      revisesInstanceId: "exit-1",
    });
    expect(response!.content).toContain(
      "The **Resignation/Exit Form** for **Ashley Rogers** was finalized, so I opened a new draft of it",
    );
    expect(response!.content).toContain("Edit anything that needs changing below");
  });

  it("makes the change the same sentence asked for, on the new draft", async () => {
    state.correction = {
      content: "Updated the **Resignation/Exit Form** for **Ashley Rogers**: Date that notice was given → September 27, 2026.",
      formUpdate: { instanceId: "exit-1-rev", updated: ["notice_given_date"] },
    };
    const response = await ask("duplicate exit for ashley rogers and change date notice given to 9-27-26");
    expect(state.corrected).toEqual(["exit-1-rev"]);
    expect(response!.content).toContain("Date that notice was given → September 27, 2026");
    expect(response!.formUpdate).toEqual({ instanceId: "exit-1-rev", updated: ["notice_given_date"] });
    expect(response!.formOpened!.instanceId).toBe("exit-1-rev");
  });

  it("opens a draft as it is, without revising anything", async () => {
    state.rows = [row({ status: "draft" })];
    const response = await ask("edit the exit form for Ashley Rogers");
    expect(state.revised).toEqual([]);
    expect(response!.formOpened).toEqual({
      instanceId: "exit-1",
      templateName: "Resignation/Exit Form",
      revisesInstanceId: null,
    });
    expect(response!.content).toContain("is still a draft");
  });

  it("asking twice lands on the draft the first request opened", async () => {
    await ask("change exit for ashley rogers");
    const second = await ask("change exit for ashley rogers");
    expect(state.revised).toEqual(["exit-1"]);
    expect(second!.formOpened!.instanceId).toBe("exit-1-rev");
  });

  it("follows a revised form in the conversation to its newer version", async () => {
    state.rows = [
      row({ status: "revised", events: [{ kind: "revised", detail: { revisionId: "exit-2" } }] }),
      row({ id: "exit-2", status: "draft", revisesInstanceId: "exit-1" }),
    ];
    const response = await ask("change the exit form", "exit-1");
    expect(state.revised).toEqual([]);
    expect(response!.formOpened!.instanceId).toBe("exit-2");
    expect(response!.content).toContain("already has a newer draft");
  });

  it("chooses the named employee's newest form, not somebody else's", async () => {
    state.rows = [
      row({ id: "exit-old", createdAt: "2026-08-01T12:00:00Z" }),
      row({ id: "exit-new", createdAt: "2026-10-01T12:00:00Z" }),
      row({ id: "exit-other", employeeName: "Jane Doe", createdAt: "2026-10-10T12:00:00Z" }),
      row({ id: "coaching-1", templateKey: "coaching", templateName: "Coaching Form", createdAt: "2026-10-15T12:00:00Z" }),
    ];
    const response = await ask("change exit for ashley rogers");
    expect(state.revised).toEqual(["exit-new"]);
    expect(response!.formOpened!.revisesInstanceId).toBe("exit-new");
  });

  it("shows a finalized form as it is when asked to see it", async () => {
    const response = await ask("show draft of exit", "exit-1");
    expect(state.revised).toEqual([]);
    expect(response!.formOpened).toEqual({
      instanceId: "exit-1",
      templateName: "Resignation/Exit Form",
      revisesInstanceId: null,
    });
    expect(response!.content).toContain("Edit as new draft");
  });

  it("says so when the named employee has no such form on file", async () => {
    const response = await ask("change exit for Morgan Lee");
    expect(state.revised).toEqual([]);
    expect(response!.formOpened).toBeUndefined();
    expect(response!.content).toContain("couldn't find a **Resignation/Exit Form** for **Morgan Lee**");
  });

  it("leaves a proposal still waiting to be created to the proposal flow", async () => {
    const response = await reopenRequestedForm({
      request: new Request("http://localhost/api/chat"),
      question: "change the exit form for Ashley Rogers",
      history: [],
      today: "2026-10-20",
      continuingTemplateKey: "stc-exit",
    });
    expect(response).toBeNull();
    expect(state.revised).toEqual([]);
  });

  it.each(["create exit for Ashley Rogers", "how do I change an exit form?", "what is the dress code?"])(
    "leaves %s to the ordinary flow",
    async (question) => {
      expect(await ask(question)).toBeNull();
      expect(state.listed).toBe(0);
      expect(state.revised).toEqual([]);
    },
  );
});
