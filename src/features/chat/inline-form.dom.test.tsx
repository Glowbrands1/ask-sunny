// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { MessageBubble } from "./message-bubble";
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
      status: "draft",
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
  };
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

function bubble(message: ChatMessage, conversation: ChatMessage[] = [ACCOUNT, message]) {
  return render(
    <MessageBubble
      message={message}
      conversation={conversation}
      onSuggestion={() => {}}
      onFormCreated={onFormCreated}
    />,
  );
}

beforeEach(() => {
  recorded = [];
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
    ["a non-Coaching template", proposal({ templateKey: "dpoa", templateName: "Disciplinary Plan of Action", supportsInlineDraft: false })],
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

describe("no Phase 4 control appears anywhere in the inline flow", () => {
  it.each(["Finalize", "Download PDF", "Start another", "View in Form Monitoring"])(
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
