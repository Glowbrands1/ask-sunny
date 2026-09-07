import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  DRAFT_FAILED_WARNING,
  NO_NOTES_WARNING,
  createInlineForm,
} from "./create-inline-form";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 11-14, 19, 24-25, 34 — PROPOSAL BECOMES A CANONICAL FORM
 * ============================================================================
 *
 * The order of the two requests is the design, and it is irreversible: once the
 * create returns, a real HR record exists in Postgres. Everything after that
 * point must be survivable — a drafting failure warns, it does not unwind.
 */

let counter = 0;
function userTurn(content: string): ChatMessage {
  counter += 1;
  return {
    id: `msg-${counter}`,
    role: "user",
    content,
    createdAt: "2026-01-05T10:00:00.000Z",
  };
}

const ACCOUNT = userTurn(
  "Sarah has been late three times this week. I spoke with her this morning and explained she needs to arrive on time for every scheduled shift.",
);

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    supportsInlineDraft: true,
    employeeName: "Sarah Jones",
    locationId: "loc-0101",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: [ACCOUNT.id],
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Records the order of `onCreated` against the requests, for finding 1. */
function watcher() {
  const seen: string[] = [];
  const onCreated = vi.fn<(reference: ChatFormInstanceRef) => void>(() => {
    seen.push("onCreated");
  });
  return { seen, onCreated };
}

function recorder(options: { draftFails?: boolean; createFails?: boolean } = {}) {
  const calls: Call[] = [];
  const call = vi.fn().mockImplementation(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    if (url.endsWith("/draft")) {
      if (options.draftFails) throw new Error("Ask Sunny could not be reached.");
      return { values: {}, checked: {}, withheld: [] };
    }
    if (options.createFails) throw new Error("That salon is not one you are assigned to.");
    return { instance: { id: "inst-42" } };
  });
  return { calls, call };
}

describe("11-12. the canonical endpoint is called, with source ask_sunny", () => {
  it("posts to /api/forms/instances", async () => {
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    expect(calls[0]!.url).toBe("/api/forms/instances");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body.source).toBe("ask_sunny");
  });

  it("does not invent a chat-specific form endpoint", async () => {
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    for (const made of calls) {
      expect(made.url.startsWith("/api/forms/")).toBe(true);
      expect(made.url).not.toMatch(/chat/);
    }
  });
});

describe("13. the proposal selects an intent and supplies nothing else", () => {
  it("sends only the four values the server can re-derive or needs", async () => {
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    expect(Object.keys(calls[0]!.body).sort()).toEqual([
      "employeeName",
      "locationId",
      "source",
      "templateKey",
    ]);
  });

  it("sends no template version, status, values or display name", async () => {
    /*
     * Every one of these would be a browser telling the server something the
     * server must decide: the version is pinned from the published current
     * version, status is always `draft`, and a salon display name would come
     * from `DEMO_LOCATIONS`.
     */
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    const body = calls[0]!.body;
    for (const forbidden of [
      "templateVersionId",
      "templateVersion",
      "status",
      "values",
      "checked",
      "locationName",
      "templateName",
      "createdBy",
      "createdByRole",
    ]) {
      expect(body, forbidden).not.toHaveProperty(forbidden);
    }
  });
});

describe("19-20. the existing drafting endpoint is reused, with manager words only", () => {
  it("posts the retained manager turns to the instance's draft route", async () => {
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    expect(calls[1]!.url).toBe("/api/forms/instances/inst-42/draft");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.body.notes).toContain("late three times this week");
  });

  it("does not send an assistant turn as factual HR input", async () => {
    const sunny: ChatMessage = {
      id: "msg-sunny",
      role: "assistant",
      content: "Understood — was this Jane Kowalski, and was it three occasions?",
      createdAt: "2026-01-05T10:00:00.000Z",
    };

    const { calls, call } = recorder();
    await createInlineForm({
      proposal: proposal({ sourceMessageIds: [ACCOUNT.id, sunny.id] }),
      messages: [ACCOUNT, sunny],
      call,
      onCreated: () => {},
    });

    const notes = String(calls[1]!.body.notes);
    expect(notes).not.toContain("Jane Kowalski");
    expect(notes).not.toContain("was it three occasions");
  });

  it("does not send a turn the bounded window dropped", async () => {
    const older = userTurn("Marcus was late twice last month and I let it go.");
    const { calls, call } = recorder();

    await createInlineForm({
      // `sourceMessageIds` names only the retained turn.
      proposal: proposal({ sourceMessageIds: [ACCOUNT.id] }),
      messages: [older, ACCOUNT],
      call,
      onCreated: () => {},
    });

    expect(String(calls[1]!.body.notes)).not.toContain("Marcus");
  });

  it("sends the account and nothing invented alongside it", async () => {
    const { calls, call } = recorder();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    // Only `notes`. No topic it made up, no follow-up date, no employee role.
    expect(Object.keys(calls[1]!.body)).toEqual(["notes"]);
    const notes = String(calls[1]!.body.notes);
    for (const invented of ["Jane Kowalski", "Tanning Consultant", "follow", "14 days"]) {
      expect(notes, invented).not.toContain(invented);
    }
  });
});

/* ==================================================================== */
/*  REMEDIATION FINDING 1 — THE REFERENCE IS REPORTED BEFORE DRAFTING   */
/* ==================================================================== */

describe("F1. a real form is never live while chat still offers to create one", () => {
  it("calls onCreated BEFORE the drafting request is made", async () => {
    /*
     * The window this closes: the drafting route allows 120 seconds. Reporting
     * the reference only when the whole function resolved meant a real HR
     * record existed in Postgres — visible in Form Monitoring — while chat
     * still showed "Create draft". A second click, or a reload, filed a second
     * disciplinary record.
     */
    const order: string[] = [];
    const call = vi.fn().mockImplementation(async (url: string) => {
      order.push(url.endsWith("/draft") ? "draft-request" : "create-request");
      if (url.endsWith("/draft")) return { values: {}, checked: {} };
      return { instance: { id: "inst-42" } };
    });

    await createInlineForm({
      proposal: proposal(),
      messages: [ACCOUNT],
      call,
      onCreated: () => order.push("onCreated"),
    });

    expect(order).toEqual(["create-request", "onCreated", "draft-request"]);
  });

  it("reports it before a drafting request that never returns", async () => {
    // The realistic failure: the model hangs. The reference must already be
    // persisted by then, not waiting on a promise that will not settle.
    // Initialized to a no-op so TypeScript does not narrow it to `null`: the
    // assignment happens inside a callback it cannot follow.
    let release = () => {};
    const hanging = new Promise<{ values: Record<string, string> }>((resolve) => {
      release = () => resolve({ values: {} });
    });
    const call = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/draft")) return hanging;
      return { instance: { id: "inst-42" } };
    });

    const { onCreated } = watcher();
    const pending = createInlineForm({
      proposal: proposal(),
      messages: [ACCOUNT],
      call,
      onCreated,
    });

    // Let the create resolve, but leave the draft hanging.
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0]![0].instanceId).toBe("inst-42");

    release();
    await pending;
  });

  it("reports it exactly once, whatever drafting does", async () => {
    const { call } = recorder({ draftFails: true });
    const { onCreated } = watcher();
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated });

    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("does not report one when the create itself failed", async () => {
    const { call } = recorder({ createFails: true });
    const { onCreated } = watcher();

    await expect(
      createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated }),
    ).rejects.toThrow();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("34. the form survives a drafting failure", () => {
  it("keeps the created instance and warns, rather than unwinding", async () => {
    const { calls, call } = recorder({ draftFails: true });
    const result = await createInlineForm({
      proposal: proposal(),
      messages: [ACCOUNT],
      call,
      onCreated: () => {},
    });

    expect(result.reference.instanceId).toBe("inst-42");
    expect(result.draftWarning).toBe(DRAFT_FAILED_WARNING);
    // Exactly two requests: the create, and the draft that failed.
    expect(calls).toHaveLength(2);
  });

  it("never deletes the form, retries the create, or creates a second one", async () => {
    const { calls, call } = recorder({ draftFails: true });
    await createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} });

    const creates = calls.filter((made) => made.url === "/api/forms/instances");
    expect(creates).toHaveLength(1);
    expect(calls.some((made) => made.method === "DELETE")).toBe(false);
  });

  it("skips drafting entirely when the conversation cannot support it", async () => {
    const thin = userTurn("ok");
    const { calls, call } = recorder();
    const result = await createInlineForm({
      proposal: proposal({ sourceMessageIds: [thin.id] }),
      messages: [thin],
      call,
      onCreated: () => {},
    });

    // The form still exists; nothing was sent to a model to write from "ok".
    expect(result.reference.instanceId).toBe("inst-42");
    expect(result.draftWarning).toBe(NO_NOTES_WARNING);
    expect(calls).toHaveLength(1);
  });
});

describe("a failed create produces no reference at all", () => {
  it("throws rather than reporting a form that does not exist", async () => {
    const { calls, call } = recorder({ createFails: true });
    await expect(
      createInlineForm({ proposal: proposal(), messages: [ACCOUNT], call, onCreated: () => {} }),
    ).rejects.toThrow(/not one you are assigned to/);

    // And no drafting call was made against an instance that was never created.
    expect(calls).toHaveLength(1);
  });
});

describe("29. the reference is a pointer, not a copy", () => {
  it("carries the id, the proposal it came from, and a label", async () => {
    const { call } = recorder();
    const result = await createInlineForm({
      proposal: proposal(),
      messages: [ACCOUNT],
      call,
      onCreated: () => {},
    });

    expect(Object.keys(result.reference).sort()).toEqual([
      "instanceId",
      "proposalId",
      "templateName",
    ]);
    expect(result.reference.instanceId).toBe("inst-42");
    expect(result.reference.proposalId).toBe("prop-1");
  });
});


/* ==================================================================== */
/*  REQUIREMENTS 27-28 — THE GUARDS THE INLINE PATH INHERITS            */
/* ==================================================================== */

/**
 * The inline flow builds NO SECOND DRAFTING PATH. It posts to the endpoint the
 * Create a Form workspace already uses, so every guard that endpoint applies
 * applies here unchanged — which is only worth anything while those guards are
 * still in it.
 *
 * Comments stripped, because the route documents its own rules at length and a
 * raw scan would match the explanation rather than the code.
 */
describe("27-28. the existing draft endpoint's guards are still the ones running", () => {
  const route = readFileSync("src/app/api/forms/instances/[id]/draft/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("reads the field list from the STORED VERSION, not from the request", () => {
    // A client cannot widen what may be written by sending a longer list. The
    // instance now arrives through `authorizeInstance`, which loads it, applies
    // the template's own permission and checks the form's salon — so the
    // stored-version guarantee is unchanged and the route is scoped too.
    expect(route).toContain('authorizeInstance(request, id, "edit")');
    expect(route).toContain("draftableFields(document, variantKey)");
    expect(route).not.toMatch(/body\.fields|body\.values|body\.checked/);
  });

  it("filters the model's output through the responsibility guard", () => {
    // Signature blocks carry no key at all, so a signature has nothing to
    // address — and `applyAssistantDraft` re-filters whatever comes back.
    expect(route).toContain("applyAssistantDraft");
  });

  it("still fails closed on a policy-grounded field with no approved policy", () => {
    expect(route).toContain("dropUngroundedPolicy");
    expect(route).toContain("APPROVED POLICY: none found. Leave every policy field empty.");
    // Retrieval runs on the MANAGER'S words, before the model, so the quotation
    // it may use cannot be steered by anything the model produced.
    expect(route.indexOf("groundPolicy")).toBeLessThan(route.indexOf("client.messages.create"));
  });

  it("refuses to draft a form that is no longer a draft", () => {
    expect(route).toContain('loaded.instance.status !== "draft"');
  });
});

describe("no second drafting path was built", () => {
  it("chat posts to the canonical instance draft route and calls no model itself", () => {
    const chat = readFileSync("src/features/chat/create-inline-form.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(chat).toContain("/draft");
    for (const forbidden of ["anthropic", "Anthropic", "messages.create", "CLAUDE_MODEL"]) {
      expect(chat, forbidden).not.toContain(forbidden);
    }
  });
});
