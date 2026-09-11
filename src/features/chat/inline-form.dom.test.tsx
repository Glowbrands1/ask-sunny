// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { MessageBubble } from "./message-bubble";
import { InlineForm, policyVerificationNoticeFor } from "./inline-form";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 7-10, 18, 30-33, 35-45 — THE FLOW A MANAGER ACTUALLY TOUCHES
 * ============================================================================
 *
 * Rendered rather than source-scanned, because the failures that matter here
 * are invisible to a source scan: a button present but inert, a "Saved" that
 * appears before the server answered, a double-click that files two
 * disciplinary records.
 *
 * `fetch` is faked at the boundary. Nothing here proves the real endpoints
 * behave — `app/api/forms/*.test.ts` does that — and jsdom is not a browser, so
 * nothing here is a claim about Preview.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { avatarInitials: "PC", name: "Paulyne" },
    role: "salon_director",
    isAdmin: false,
  }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/* --------------------------------------------------------------- fixtures -- */

const COACHING_DOCUMENT = {
  paper: "letter" as const,
  blocks: [
    { kind: "letterhead" as const, brand: "SUN TAN CITY", title: "Coaching Form" },
    { kind: "section" as const, label: "Employee Information" },
    {
      kind: "field_row" as const,
      fields: [
        { key: "employee_name", label: "Employee Name", input: "text" as const, responsibility: "system" as const },
        { key: "form_date", label: "Date", input: "date" as const, responsibility: "system" as const },
      ],
    },
    {
      kind: "checkbox_group" as const,
      key: "coaching_type",
      label: "Type Of Coaching",
      options: [
        { key: "under_performance", label: "Under Performance" },
        { key: "re_training", label: "Re-Training" },
      ],
      responsibility: "ai" as const,
      columns: 2 as const,
    },
    { kind: "section" as const, label: "Details" },
    {
      kind: "field" as const,
      field: {
        key: "coaching_details",
        label: "Details",
        input: "long_text" as const,
        responsibility: "ai" as const,
      },
    },
    {
      kind: "field" as const,
      field: {
        key: "handwritten_note",
        label: "Completed in the meeting",
        input: "text" as const,
        responsibility: "manual" as const,
      },
    },
    { kind: "signature_row" as const, label: "Employee Signature", dateLabel: "Date" },
  ],
};

function loadedInstance(overrides: Record<string, unknown> = {}) {
  return {
    instance: {
      id: "inst-42",
      templateName: "Coaching Form",
      templateVersion: 1,
      templateVersionId: "ver-1",
      variantKey: null,
      employeeName: "Sarah Jones",
      locationId: "loc-0101",
      locationName: null,
      source: "ask_sunny",
      status: "draft" as "draft" | "finalized" | "revised",
      followUpDate: null as string | null,
      ...overrides,
    },
    version: { document: COACHING_DOCUMENT, variants: [] },
    values: [
      { fieldKey: "employee_name", value: "Sarah Jones", checked: [], filledBy: "system" },
      {
        fieldKey: "coaching_details",
        value: "Arrived late on three shifts this week.",
        checked: [],
        filledBy: "ai",
      },
    ],
    events: [
      { kind: "created", actor: "user-1", createdAt: "2026-09-07T12:00:00Z" },
      { kind: "drafted", actor: "user-1", createdAt: "2026-09-07T12:00:05Z" },
    ],
  };
}

/** The instance as it is the instant it is created: seeded, never drafted. */
function seededInstance() {
  const loaded = loadedInstance();
  loaded.values = [
    { fieldKey: "employee_name", value: "Sarah Jones", checked: [], filledBy: "system" },
  ];
  loaded.events = [{ kind: "created", actor: "user-1", createdAt: "2026-09-07T12:00:00Z" }];
  return loaded;
}

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
    sourceMessageIds: ["msg-account"],
    ...overrides,
  };
}

const ACCOUNT: ChatMessage = {
  id: "msg-account",
  role: "user",
  content:
    "Sarah has been late three times this week. I spoke with her this morning about arriving on time.",
  createdAt: "2026-09-07T12:00:00Z",
};

function assistantTurn(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-answer",
    role: "assistant",
    content: "Here is what I would put on a **Coaching Form**.",
    createdAt: "2026-09-07T12:00:01Z",
    mode: "standard",
    coverage: "not_applicable",
    citations: [],
    recommendedVideoIds: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ fetch -- */

interface Recorded {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let recorded: Recorded[] = [];
/*
 * Typed to the prop it stands in for. `vi.fn()` alone widens to
 * `Mock<Procedure | Constructable>`, which does not satisfy the callback and
 * would need a cast at every render.
 */
let onFormCreated: ReturnType<
  typeof vi.fn<(messageId: string, reference: ChatFormInstanceRef) => void>
>;

function fakeFetch(
  handler: (url: string, init: RequestInit) => { ok?: boolean; payload: unknown } | Promise<{ ok?: boolean; payload: unknown }>,
) {
  globalThis.fetch = vi.fn().mockImplementation(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    recorded.push({
      url,
      method: String(init.method ?? "GET"),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    const result = await handler(url, init);
    return {
      ok: result.ok !== false,
      json: async () => result.payload,
    } as unknown as Response;
  }) as typeof fetch;
}

/** The whole happy path: create, draft, then load. */
function happyPath(options: { draftFails?: boolean } = {}) {
  fakeFetch((url, init) => {
    if (url === "/api/forms/instances" && init.method === "POST") {
      return { payload: { instance: { id: "inst-42" } } };
    }
    if (url.endsWith("/draft")) {
      if (options.draftFails) return { ok: false, payload: { error: "Sunny is unavailable." } };
      return { payload: { values: {}, checked: {}, withheld: [] } };
    }
    if (url === "/api/forms/instances/inst-42" && init.method === "PATCH") {
      const sent = JSON.parse(String(init.body)) as { values: Record<string, string> };
      const loaded = loadedInstance();
      loaded.values = Object.entries(sent.values).map(([fieldKey, value]) => ({
        fieldKey,
        value,
        checked: [],
        filledBy: "manager" as const,
      }));
      return { payload: loaded };
    }
    return { payload: loadedInstance() };
  });
}

/** The most recent render, so a helper can create and a test can then read it. */
let renderResult: ReturnType<typeof render> | null = null;

function bubble(message: ChatMessage, conversation: ChatMessage[] = [ACCOUNT, message]) {
  renderResult = render(
    <MessageBubble
      message={message}
      conversation={conversation}
      onSuggestion={() => {}}
      onFormCreated={onFormCreated}
    />,
  );
  return renderResult;
}

beforeEach(() => {
  recorded = [];
  renderResult = null;
  onFormCreated = vi.fn<(messageId: string, reference: ChatFormInstanceRef) => void>();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
});

/* ================================================== when Create draft shows */

describe("7. a ready Coaching proposal offers a working Create draft", () => {
  it("renders the action", () => {
    happyPath();
    bubble(assistantTurn({ formProposal: proposal() }));
    expect(screen.getByRole("button", { name: /create draft/i })).toBeTruthy();
  });
});

describe("8-10. every other proposal state offers no create action", () => {
  it.each([
    ["needs_employee", proposal({ employeeName: null, status: "needs_employee", supportsInlineDraft: false })],
    ["needs_location", proposal({ locationId: null, status: "needs_location", locationResolution: "unavailable", supportsInlineDraft: false })],
    ["multiple salons", proposal({ locationId: null, status: "needs_location", locationResolution: "needs_selection", supportsInlineDraft: false })],
    ["a non-Coaching template", proposal({ templateKey: "dpoa", templateName: "Corrective Action Form", supportsInlineDraft: false })],
  ])("%s", (_name, state) => {
    happyPath();
    const { container } = bubble(assistantTurn({ formProposal: state }));

    // No control at all — not a disabled one. The gap is the reason it is not
    // offered, and a greyed-out button invites a hunt for what would enable it.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/create draft/i);
  });
});

/* ======================================================== creating the form */

describe("18. the create cannot be submitted twice by normal UI use", () => {
  it("fires one create for a double click", async () => {
    happyPath();
    bubble(assistantTurn({ formProposal: proposal() }));
    const button = screen.getByRole("button", { name: /create draft/i });

    // Both activations dispatched before any await resolves — the race a
    // disabled attribute alone would lose, because it applies a render later.
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(onFormCreated).toHaveBeenCalled());
    const creates = recorded.filter((made) => made.url === "/api/forms/instances");
    expect(creates).toHaveLength(1);
  });

  it("stops offering the action once an instance exists", () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      }),
    );
    expect(container.textContent).not.toMatch(/create draft/i);
  });
});

describe("29. the created form is reported as a reference", () => {
  it("hands back the id, the proposal and a label — and no values", async () => {
    happyPath();
    bubble(assistantTurn({ formProposal: proposal() }));
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() => expect(onFormCreated).toHaveBeenCalled());
    const [messageId, reference] = onFormCreated.mock.calls[0]!;

    expect(messageId).toBe("msg-answer");
    expect(Object.keys(reference).sort()).toEqual([
      "instanceId",
      "proposalId",
      "templateName",
    ]);
  });
});

/* ============================================================= the editor == */

describe("30-31. the editor fetches the instance by id", () => {
  it("reads the server's values rather than anything stored in chat", async () => {
    happyPath();
    bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("Arrived late on three shifts this week.")).toBeTruthy(),
    );
    expect(recorded.some((made) => made.url === "/api/forms/instances/inst-42")).toBe(true);
  });
});

describe("32-33. a form the server will not return is not recreated", () => {
  it.each([
    ["404", "No such form."],
    ["403", "Your role does not have permission to do that."],
  ])("%s", async (_status, error) => {
    fakeFetch(() => ({ ok: false, payload: { error } }));
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toMatch(/not available/i));
    expect(container.textContent).toMatch(/has not created another one/i);
    // No create, no retry, and no route back to the standalone builder.
    expect(recorded.some((made) => made.method === "POST")).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("35-37. the editor renders from the stored template version", () => {
  it("shows the version's own sections, fields and options", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(container.textContent).toContain("Type Of Coaching");
    expect(container.textContent).toContain("Under Performance");
    expect(screen.getByDisplayValue("Sarah Jones")).toBeTruthy();
  });

  it("hard-codes no Coaching field list in the chat components", () => {
    /*
     * The renderer must follow the published template. If Coaching gains a
     * field tomorrow, a newly created instance carries it and this editor shows
     * it — which is only true while no chat component names the fields itself.
     */
    for (const file of [
      "src/features/chat/inline-form.tsx",
      "src/features/chat/message-bubble.tsx",
      "src/features/chat/create-inline-form.ts",
    ]) {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      for (const fieldKey of [
        "coaching_details",
        "coaching_type",
        "coaching_topics",
        "other_topic",
        "job_title",
      ]) {
        expect(source, `${file} names ${fieldKey}`).not.toContain(fieldKey);
      }
    }
  });
});

describe("38-41. editing and saving", () => {
  it("saves through the canonical instance endpoint", async () => {
    happyPath();
    bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    const details = await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(details, { target: { value: "Late twice, not three times." } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    const patch = recorded.find((made) => made.method === "PATCH")!;
    expect(patch.url).toBe("/api/forms/instances/inst-42");
    expect((patch.body.values as Record<string, string>).coaching_details).toBe(
      "Late twice, not three times.",
    );
  });

  it("does not say Saved before the server confirms", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    const details = await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(details, { target: { value: "Edited." } });

    // Dirty, and saying so — not "Saved".
    expect(container.textContent).toContain("Unsaved changes");
    expect(container.textContent).not.toContain("Saved");
  });

  it("keeps the manager's typing when a save fails", async () => {
    fakeFetch((url, init) => {
      if (init.method === "PATCH") return { ok: false, payload: { error: "Network trouble." } };
      return { payload: loadedInstance() };
    });

    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    const details = await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(details, { target: { value: "Five minutes of typing." } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(container.textContent).toMatch(/network trouble/i));
    // The worst possible response to a blip would be discarding this.
    expect(screen.getByDisplayValue("Five minutes of typing.")).toBeTruthy();
    expect(container.textContent).toMatch(/your changes are still here/i);
  });
});

describe("42. field responsibility is respected in the inline editor", () => {
  it("gives a signature line no control at all", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Signature"));
    // Not a disabled input — no input. It is signed on paper.
    const signatureInputs = [...container.querySelectorAll("input")].filter((input) =>
      (input.getAttribute("aria-label") ?? input.id).toLowerCase().includes("signature"),
    );
    expect(signatureInputs).toHaveLength(0);
    expect(container.textContent).toMatch(/Always blank — signed by hand/);
  });

  it("shows a hand-filled line without letting it be typed into", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Completed in the meeting"));
    const manual = container.querySelector<HTMLInputElement>("#form-field-handwritten_note")!;
    expect(manual.disabled).toBe(true);
    expect(container.textContent).toMatch(/Filled by hand/);
  });

  it("lets the manager edit an AI-drafted field, which is the point of drafting", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Details"));
    const details = container.querySelector<HTMLTextAreaElement>("#form-field-coaching_details")!;
    expect(details.disabled).toBe(false);
  });
});

describe("34. a drafting failure leaves one real form and says so", () => {
  it("shows the editor with a warning, not an error that unwinds", async () => {
    happyPath({ draftFails: true });
    const { container } = bubble(assistantTurn({ formProposal: proposal() }));

    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(onFormCreated).toHaveBeenCalled());

    // The reference was reported even though drafting failed.
    expect(onFormCreated.mock.calls[0]![1].instanceId).toBe("inst-42");
    const creates = recorded.filter((made) => made.url === "/api/forms/instances");
    expect(creates).toHaveLength(1);
    expect(container.textContent).not.toMatch(/create draft/i);
  });
});

/* ============================================== phase boundaries and layout */

describe("43. the coaching flow holds no route to the standalone builder", () => {
  it("never redirects and never mentions /forms/create", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(push).not.toHaveBeenCalled();

    for (const file of [
      "src/features/chat/inline-form.tsx",
      "src/features/chat/message-bubble.tsx",
      "src/features/chat/create-inline-form.ts",
      "src/features/forms/document/responsive-form.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("/forms/create");
    }
  });
});

describe("44-45. the inline renderer has no paper geometry", () => {
  it("imports neither the paper module nor DocumentSurface", () => {
    /*
     * Marissa named the form's horizontal scrollbar specifically. `Sheet` is a
     * fixed 816px that scales with a transform rather than reflowing — right
     * for the template editor, wrong inside a conversation.
     */
    for (const file of [
      "src/features/forms/document/responsive-form.tsx",
      "src/features/chat/inline-form.tsx",
    ]) {
      // Comments stripped first: both files EXPLAIN why they do not use the
      // paper renderer, and a raw scan would match their own explanation.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(source, file).not.toContain("document-surface");
      expect(source, file).not.toContain("DocumentSurface");
      expect(source, file).not.toContain("forms/paper");
      expect(source, file).not.toContain("PAGE_PX");
    }
  });

  it("sets no fixed width and stacks its rows on a narrow screen", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));

    // No inline pixel width anywhere in the rendered form.
    for (const node of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(node.getAttribute("style") ?? "").not.toMatch(/width:\s*\d+px/);
    }

    // The two-up row is one column by default and two only from `sm` up.
    const row = container.querySelector(".grid.min-w-0.grid-cols-1")!;
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("sm:grid-cols-2");
  });

  it("keeps min-w-0 on the containers a long value could otherwise widen", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    // Without it a flex/grid child defaults to min-content width and pushes the
    // whole thread sideways — the exact complaint being fixed.
    expect(container.querySelectorAll(".min-w-0").length).toBeGreaterThan(3);
  });
});

/**
 * ============================================================================
 * PHASE 4 — WHICH CONTROLS BELONG TO WHICH STATE
 * ============================================================================
 *
 * Phase 3 asserted that NONE of these existed, because none of them worked. The
 * rule that produced that assertion has not changed: a control appears only
 * when it does something. What changed is which ones now do.
 *
 * DRAFT      Save changes · Finalize · the follow-up date
 * FINALIZED  Download PDF · View in Form Monitoring · Start another
 *
 * Crossing them over would be the same defect in a new place: a Download PDF on
 * an unfinalized draft hands somebody an unsigned document that looks final,
 * and a Finalize on a frozen record does nothing.
 */
describe("P4. a draft offers editing, and nothing that implies a finished record", () => {
  it("offers Save changes, Finalize and a follow-up date", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /finalize/i })).toBeTruthy();
    expect(container.querySelector("#follow-up-inst-42")).toBeTruthy();
  });

  it.each(["Download PDF", "View in Form Monitoring", "Start another"])(
    "offers no %s",
    async (label) => {
      happyPath();
      const { container } = bubble(
        assistantTurn({
          formProposal: proposal(),
          formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
        }),
      );

      await waitFor(() => expect(container.textContent).toContain("Employee Information"));
      expect(container.textContent).not.toContain(label);
    },
  );

  it("says plainly what finalizing does before it is pressed", async () => {
    happyPath();
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(container.textContent).toMatch(/freezes these values/i);
  });
});

describe("a finalized form renders read-only rather than assuming a draft", () => {
  it("shows the values and no save control", async () => {
    fakeFetch(() => ({ payload: loadedInstance({ status: "finalized" }) }));
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    expect(container.textContent).not.toMatch(/save changes/i);
    const details = container.querySelector<HTMLTextAreaElement>("#form-field-coaching_details")!;
    expect(details.disabled).toBe(true);
  });
});


/* ==================================================================== */
/*  REMEDIATION 2, FINDING 1 — PREFILL AND THE EDITOR                   */
/* ==================================================================== */

/**
 * ============================================================================
 * THE RACE REMEDIATION 1 EXPOSED
 * ============================================================================
 *
 * Persisting the reference immediately was right and is not moving. But the
 * editor then rendered immediately too, fetched the SEEDED instance, and never
 * refetched — while Sunny spent up to two minutes writing the real values into
 * the same row.
 *
 * Two failures in one. The manager sees an empty-looking form and concludes
 * Sunny did not fill it in, when the backend succeeded — which is exactly
 * Marissa's requirement appearing not to work. And if they start typing, their
 * edit and the assistant's write land on the same canonical record in whatever
 * order they arrive.
 */

/** A create that succeeds, then a draft the test releases when it chooses. */
function delayedDraft() {
  let release: (drafted?: boolean) => void = () => {};
  let failDraft: () => void = () => {};
  let drafted = false;

  const pending = new Promise<{ ok?: boolean; payload: unknown }>((resolve) => {
    release = (didDraft = true) => {
      drafted = didDraft;
      resolve({ payload: { values: {}, checked: {}, withheld: [] } });
    };
    failDraft = () => resolve({ ok: false, payload: { error: "Sunny is unavailable." } });
  });

  fakeFetch(async (url, init) => {
    if (url === "/api/forms/instances" && init.method === "POST") {
      return { payload: { instance: { id: "inst-42" } } };
    }
    if (url.endsWith("/draft")) return pending;
    if (init.method === "PATCH") return { payload: loadedInstance() };
    /*
     * THE CANONICAL READ. Before drafting settles it holds only the seeded
     * value; afterwards it holds what Sunny wrote. A component that never
     * refetches can only ever show the first of those.
     */
    if (!drafted) return { payload: seededInstance() };
    const withDraft = loadedInstance();
    withDraft.values = [
      { fieldKey: "employee_name", value: "Sarah Jones", checked: [], filledBy: "system" },
      {
        fieldKey: "coaching_details",
        value: "Sarah was late twice.",
        checked: [],
        filledBy: "ai",
      },
    ];
    return { payload: withDraft };
  });

  return { release, failDraft };
}

async function createAndWait() {
  bubble(assistantTurn({ formProposal: proposal() }));
  fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
  await waitFor(() => expect(onFormCreated).toHaveBeenCalled());
}

describe("R2-F1. the reference is still persisted before drafting", () => {
  it("reports it while the draft is still pending", async () => {
    // The Remediation 1 invariant, re-asserted here so this phase cannot
    // quietly undo it while fixing the race it exposed.
    const { release } = delayedDraft();
    await createAndWait();

    expect(onFormCreated.mock.calls[0]![1].instanceId).toBe("inst-42");
    expect(recorded.some((made) => made.url.endsWith("/draft"))).toBe(true);
    release();
  });
});

describe("R2-F1. no editable stale form while Sunny is still writing", () => {
  it("renders read-only with an honest loading state", async () => {
    const { release } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));

    expect(container.textContent).toMatch(/Sunny is filling it in from your conversation/i);
    expect(container.textContent).toMatch(/Editing opens as soon as Sunny is finished/i);

    // Every control is inert, and there is no way to submit.
    const details = container.querySelector<HTMLTextAreaElement>("#form-field-coaching_details")!;
    expect(details.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();

    release();
  });

  it("still says Draft, because it is one", async () => {
    /*
     * `readOnly` covers two different situations now — frozen, and busy — and
     * the label must only ever describe the first. "Finalized" on an unsigned
     * draft is a false statement about an HR record.
     */
    const { release } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));

    expect(container.textContent).toContain("Draft");
    expect(container.textContent).not.toContain("Finalized");
    release();
  });

  it("fires no PATCH while the draft is pending", async () => {
    /*
     * THE WRITE RACE. Two writers on one canonical record, ordered by whichever
     * request happens to land second.
     */
    const { release } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));

    expect(recorded.some((made) => made.method === "PATCH")).toBe(false);
    release();
  });
});

describe("R2-F1. the drafted values appear when prefill completes", () => {
  it("reloads the canonical instance and shows what the server stored", async () => {
    const { release } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    // The pre-draft read: Sunny's text is genuinely not there yet.
    expect(container.textContent).not.toContain("Sarah was late twice.");

    release();

    // No refresh, no second click — the editor re-reads on its own.
    await waitFor(() => expect(screen.getByDisplayValue("Sarah was late twice.")).toBeTruthy());
  });

  it("opens editing only after that reload", async () => {
    const { release } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    release();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy(),
    );
    const details = container.querySelector<HTMLTextAreaElement>("#form-field-coaching_details")!;
    expect(details.disabled).toBe(false);
    expect(container.textContent).not.toMatch(/Sunny is filling it in/i);
  });

  it("takes the values from the canonical GET, not the draft response", async () => {
    /*
     * The drafting endpoint returns the values it accepted, and copying those
     * into React would be quicker and wrong: `applyAssistantDraft` re-filters
     * them and the policy guard can withhold a field the model wrote. A value
     * the server refused would sit on screen looking saved.
     *
     * The fake draft response above carries `values: {}` — so anything visible
     * came from the re-read.
     */
    const { release } = delayedDraft();
    await createAndWait();
    release();

    await waitFor(() => expect(screen.getByDisplayValue("Sarah was late twice.")).toBeTruthy());

    const reads = recorded.filter(
      (made) => made.url === "/api/forms/instances/inst-42" && made.method === "GET",
    );
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });
});

describe("R2-F1. a failed prefill leaves one usable form", () => {
  it("warns, opens editing, and creates nothing else", async () => {
    const { failDraft } = delayedDraft();
    await createAndWait();

    const { container } = renderResult!;
    failDraft();

    await waitFor(() =>
      expect(container.textContent).toMatch(/couldn't prefill the details/i),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy(),
    );

    const creates = recorded.filter((made) => made.url === "/api/forms/instances");
    expect(creates).toHaveLength(1);
    expect(recorded.some((made) => made.method === "DELETE")).toBe(false);
  });
});

describe("R2-F1. a refresh during prefill is not mistaken for success", () => {
  it("says prefill has not completed, from the form's own event trail", async () => {
    /*
     * The conversation reopened from IndexedDB: this tab never watched the
     * prefill and cannot say whether it finished. `applyAssistantDraft` records
     * a `drafted` event, so its absence on an `ask_sunny` form means the
     * assistant never got as far as writing.
     */
    fakeFetch(() => ({ payload: seededInstance() }));
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(container.textContent).toMatch(/prefill has not completed/i);

    // Still editable: a manager who reopened a real draft must be able to work.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
  });

  it("says nothing once the drafted event is there", async () => {
    fakeFetch(() => ({ payload: loadedInstance() }));
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(container.textContent).not.toMatch(/prefill has not completed/i);
  });

  it("says nothing about prefill on a manually created form", async () => {
    // Nobody asked Sunny to fill this one in, so there is nothing to report.
    fakeFetch(() => {
      const manual = seededInstance();
      manual.instance.source = "manual";
      return { payload: manual };
    });
    const { container } = bubble(
      assistantTurn({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(container.textContent).not.toMatch(/prefill has not completed/i);
  });
});


/* ==================================================================== */
/*  PHASE 4 — FOLLOW-UP, FINALIZE, PDF, MONITORING, START ANOTHER       */
/* ==================================================================== */

/** Records every request, and lets a test drive the instance's server state. */
function phase4(initial = loadedInstance()) {
  let current = initial;

  fakeFetch(async (url, init) => {
    if (url.endsWith("/follow-up") && init.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { date: string };
      current = { ...current, instance: { ...current.instance, followUpDate: body.date } };
      return { payload: { instance: current.instance } };
    }
    if (url === "/api/forms/instances/inst-42" && init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { action: string; followUpDate: string | null };
      if (body.action !== "finalize") return { ok: false, payload: { error: "Unknown action." } };
      current = {
        ...current,
        instance: {
          ...current.instance,
          status: "finalized",
          followUpDate: body.followUpDate ?? current.instance.followUpDate,
        },
      };
      return { payload: { instance: current.instance } };
    }
    if (url === "/api/forms/instances/inst-42" && init.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { values: Record<string, string> };
      current = {
        ...current,
        values: Object.entries(body.values).map(([fieldKey, value]) => ({
          fieldKey,
          value,
          checked: [],
          filledBy: "manager" as const,
        })),
      };
      return { payload: current };
    }
    if (url.endsWith("/pdf")) return { payload: { pdf: true } };
    return { payload: current };
  });

  return { server: () => current };
}

function mounted(overrides: Partial<ChatMessage> = {}) {
  return bubble(
    assistantTurn({
      formProposal: proposal(),
      formInstanceRef: { instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" },
      ...overrides,
    }),
  );
}

describe("P4. the follow-up date is a real control, through its own route", () => {
  it("starts blank rather than inventing one", async () => {
    /*
     * There is no deterministic product rule for a default follow-up date, and
     * the prototype's "today + 14 days" was exactly the kind of manufactured HR
     * fact this workstream removed. Blank is the honest starting point.
     */
    phase4();
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    // By id: the Coaching template has its OWN `form_date` date input, so a
    // bare `input[type=date]` selector matches the form body, not this control.
    const date = container.querySelector<HTMLInputElement>("#follow-up-inst-42")!;
    expect(date.value).toBe("");
  });

  it("PUTs the chosen date and shows the server's value back", async () => {
    const { server } = phase4();
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    const date = container.querySelector<HTMLInputElement>("#follow-up-inst-42")!;
    fireEvent.change(date, { target: { value: "2026-09-21" } });
    fireEvent.click(screen.getByRole("button", { name: /set date/i }));

    await waitFor(() => expect(server().instance.followUpDate).toBe("2026-09-21"));
    const put = recorded.find((made) => made.method === "PUT")!;
    expect(put.url).toBe("/api/forms/instances/inst-42/follow-up");
    expect(put.body.date).toBe("2026-09-21");

    // And the control now reflects what came back, not what was typed.
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>("#follow-up-inst-42")!.value).toBe(
        "2026-09-21",
      ),
    );
  });

  it("shows a date the server already holds", async () => {
    const withDate = loadedInstance();
    withDate.instance.followUpDate = "2026-10-05";
    phase4(withDate);
    const { container } = mounted();

    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>("#follow-up-inst-42")!.value).toBe(
        "2026-10-05",
      ),
    );
  });
});

describe("P4. finalizing freezes the version the SERVER holds", () => {
  it("refuses while the editor has unsaved edits", async () => {
    /*
     * Finalizing freezes stored values. A manager who typed into Details and
     * finalized without saving would freeze the version WITHOUT their change,
     * and the only way back is a revision.
     */
    phase4();
    const { container } = mounted();

    const details = await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(details, { target: { value: "Late twice, not three times." } });

    const button = screen.getByRole("button", { name: /finalize/i });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.click(button);
    expect(recorded.some((made) => made.method === "POST" && made.body.action === "finalize")).toBe(
      false,
    );
    expect(container.textContent).toContain("Unsaved changes");
  });

  it("finalizes once the edit is saved, and freezes the editor", async () => {
    const { server } = phase4();
    const { container } = mounted();

    const details = await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(details, { target: { value: "Late twice, not three times." } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));

    await waitFor(() => expect(server().instance.status).toBe("finalized"));
    await waitFor(() => expect(container.textContent).toContain("Finalized"));

    // Frozen: no save control, and every field inert.
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>("#form-field-coaching_details")!.disabled,
    ).toBe(true);
    expect(container.textContent).toMatch(/a correction is a revision/i);
  });

  it("sends the canonical follow-up date with the action", async () => {
    const { server } = phase4();
    mounted();

    await screen.findByDisplayValue("Arrived late on three shifts this week.");
    fireEvent.change(document.querySelector("#follow-up-inst-42")!, {
      target: { value: "2026-09-21" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set date/i }));
    await waitFor(() => expect(server().instance.followUpDate).toBe("2026-09-21"));

    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));
    await waitFor(() => expect(server().instance.status).toBe("finalized"));
    expect(server().instance.followUpDate).toBe("2026-09-21");
  });
});

describe("P4. a finalized form offers the record, not the editor", () => {
  const finalized = () => {
    const row = loadedInstance();
    row.instance.status = "finalized";
    row.instance.followUpDate = "2026-09-21";
    return row;
  };

  it("offers Download PDF, View in Form Monitoring and Start another", async () => {
    phase4(finalized());
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /view in form monitoring/i })).toBeTruthy();
  });

  it("links Monitoring at the existing workspace, not a new one", async () => {
    phase4(finalized());
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    const link = screen.getByRole("link", { name: /view in form monitoring/i });
    expect(link.getAttribute("href")).toBe("/forms/monitoring");
  });

  it("offers no Save changes or Finalize", async () => {
    phase4(finalized());
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^finalize$/i })).toBeNull();
  });

  it("requests the PDF from the canonical endpoint", async () => {
    phase4(finalized());
    const { container } = mounted();

    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));

    await waitFor(() =>
      expect(recorded.some((made) => made.url === "/api/forms/instances/inst-42/pdf")).toBe(true),
    );
  });

  it("never builds a PDF from React state", () => {
    /*
     * The PDF renders the pinned template version and the stored values. A
     * client-side construction would print whatever this component happened to
     * be holding — including an edit the server rejected.
     */
    const source = readFileSync("src/features/chat/inline-form.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).toContain("downloadFormPdf(instanceId");
    for (const forbidden of ["jsPDF", "pdf-lib", "renderPdf"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }

    /*
     * And the download path itself touches no local state. Scoped to the
     * function rather than the file, because the SAVE path legitimately sends
     * `edits` — that is what saving is.
     */
    const body = source.slice(
      source.indexOf("async function downloadPdf()"),
      source.indexOf("async function submit()"),
    );
    expect(body).toContain("downloadFormPdf(instanceId");
    for (const forbidden of ["edits", "loaded.values", "values:"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

describe("P4. Start another begins a new request, never reusing this one", () => {
  it("calls back without touching the finalized instance", async () => {
    const row = loadedInstance();
    row.instance.status = "finalized";
    phase4(row);

    const onStartAnother = vi.fn();
    render(
      <InlineForm
        reference={{ instanceId: "inst-42", proposalId: "prop-1", templateName: "Coaching Form" }}
        prefill={{ kind: "unknown" }}
        onStartAnother={onStartAnother}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /start another/i })).toBeTruthy());
    const before = recorded.length;
    fireEvent.click(screen.getByRole("button", { name: /start another/i }));

    expect(onStartAnother).toHaveBeenCalledTimes(1);
    // No write of any kind against the finalized record.
    expect(recorded.slice(before).some((made) => made.method !== "GET")).toBe(false);
  });
});

/* ==================================================================== */
/*  A DRAFT WITH NO POLICY ON IT MUST NOT READ AS A FINISHED ONE        */
/* ==================================================================== */

/**
 * ============================================================================
 * THE HALF OF QA'S COMPLAINT THAT APPLIED HERE TOO
 * ============================================================================
 *
 * The reference platform showed a corrective action form badged READY while
 * its Direct policy field read "[Verify exact policy language from official
 * manual]" — two claims on one screen, one of them false.
 *
 * Ask Sunny never produces that string: the placeholder guard strips a
 * bracketed token before anything is stored, and the policy guard withholds a
 * policy value no approved source backs. But the honest half was missing here
 * as well. The drafting route's grounding notice was returned to the browser
 * and discarded, so the form came back with two empty fields and no reason —
 * and after a refresh there was nothing left to say it with.
 *
 * READ OFF THE STORED RECORD, which is what makes it survive the refresh.
 */
describe("the policy-verification notice", () => {
  const CORRECTIVE_DOCUMENT = {
    paper: "letter" as const,
    blocks: [
      { kind: "letterhead" as const, brand: "SUN TAN CITY", title: "Corrective Action Form" },
      {
        kind: "field" as const,
        field: {
          key: "observation",
          label: "Observation of Offense",
          input: "long_text" as const,
          responsibility: "ai" as const,
        },
      },
      {
        kind: "field" as const,
        field: {
          key: "policy_violated",
          label: "Policy Violated",
          input: "text" as const,
          responsibility: "ai" as const,
          policyGrounded: true,
        },
      },
      {
        kind: "field" as const,
        field: {
          key: "policy_language",
          label: "Direct policy from official manual",
          input: "long_text" as const,
          responsibility: "ai" as const,
          policyGrounded: true,
        },
      },
    ],
  };

  function correctiveInstance(
    values: {
      fieldKey: string;
      value: string | null;
      provenance?: Record<string, unknown>;
    }[],
  ) {
    return {
      instance: {
        id: "inst-77",
        templateName: "Corrective Action Form",
        templateVersion: 2,
        templateVersionId: "ver-2",
        variantKey: null,
        employeeName: "Sarah Test",
        locationId: "loc-0101",
        locationName: null,
        source: "ask_sunny" as const,
        status: "draft" as const,
        followUpDate: null,
      },
      version: { document: CORRECTIVE_DOCUMENT, variants: [] },
      values: values.map((row) => ({ ...row, checked: [], filledBy: "ai" as const })),
      events: [
        { kind: "created", actor: "user-1", createdAt: "2026-09-10T12:00:00Z" },
        { kind: "drafted", actor: "user-1", createdAt: "2026-09-10T12:00:05Z" },
      ],
    };
  }

  it("names the blank policy fields and what has to happen before issuing", () => {
    const notice = policyVerificationNoticeFor(
      correctiveInstance([
        { fieldKey: "observation", value: "Sarah was observed wearing a mini skirt." },
        { fieldKey: "policy_violated", value: null },
        { fieldKey: "policy_language", value: null },
      ]),
      false,
    );

    expect(notice).toMatch(/Policy verification is still required/);
    expect(notice).toContain("Policy Violated");
    expect(notice).toContain("Direct policy from official manual");
    expect(notice).toMatch(/before you issue this form/i);
  });

  it("goes when the values carry verified provenance", () => {
    const verified = { grounded: true, verified: true, sources: [{ documentId: "d1" }] };
    const notice = policyVerificationNoticeFor(
      correctiveInstance([
        { fieldKey: "policy_violated", value: "Appearance Standards", provenance: verified },
        {
          fieldKey: "policy_language",
          value: "Skirts must reach mid-thigh or longer.",
          provenance: verified,
        },
      ]),
      false,
    );

    expect(notice).toBeNull();
  });

  /*
   * ==========================================================================
   * THE BYPASS THIS TEST EXISTS FOR
   * ==========================================================================
   *
   * The first version asked whether the field was EMPTY, so typing anything
   * silenced the warning — including "Dress Code Violation", which is a tick
   * box on this very form, is in no manual, and is the exact value the
   * drafting guard had just refused to write. The form then read as complete.
   *
   * A manager typing a policy in is legitimate and is not blocked. What must
   * not happen is the app implying it checked.
   */
  it("does NOT go silent when a manager types into a policy field by hand", () => {
    const notice = policyVerificationNoticeFor(
      correctiveInstance([
        // No provenance: this is what `saveInstanceValues` writes for a person.
        { fieldKey: "policy_violated", value: "Dress Code Violation" },
        { fieldKey: "policy_language", value: null },
      ]),
      false,
    );

    expect(notice).toMatch(/Policy verification is still required/);
    expect(notice).toMatch(/entered by hand/i);
    expect(notice).toMatch(/cannot vouch for wording it did not retrieve/i);
    // And it still distinguishes the one that is simply blank.
    expect(notice).toMatch(/“Direct policy from official manual” is blank/);
  });

  it("treats provenance that is present but unverified as unverified", () => {
    const notice = policyVerificationNoticeFor(
      correctiveInstance([
        {
          fieldKey: "policy_violated",
          value: "Appearance Standards",
          provenance: { grounded: true, verified: false, sources: [] },
        },
      ]),
      false,
    );

    expect(notice).toMatch(/entered by hand|is blank/);
  });

  it("stays quiet while Sunny is still writing", () => {
    const notice = policyVerificationNoticeFor(
      correctiveInstance([{ fieldKey: "policy_violated", value: null }]),
      true,
    );

    expect(notice).toBeNull();
  });

  it("says nothing on a form nobody was promised a policy lookup for", () => {
    const manual = correctiveInstance([{ fieldKey: "policy_violated", value: null }]);
    manual.instance.source = "manual" as never;

    expect(policyVerificationNoticeFor(manual, false)).toBeNull();
  });

  it("says nothing on a form with no policy fields at all", () => {
    expect(policyVerificationNoticeFor(loadedInstance() as never, false)).toBeNull();
  });
});
