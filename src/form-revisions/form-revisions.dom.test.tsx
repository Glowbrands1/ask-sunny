// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineForm } from "@/features/chat/inline-form";
import type { ChatFormInstanceRef } from "@/types";

import { FormRevisionsMount } from "./form-revisions-mount";
import { RegisterRowActions } from "./register-row-actions";
import { REGISTER_HREF } from "./words";

/**
 * ============================================================================
 * THE REASON DIALOG, THE MARKS AND THE HISTORY, RENDERED (FORM_REVISIONS_ENABLED)
 * ============================================================================
 *
 * The form card is the real `InlineForm`, so "Edit as new draft" is its own
 * button: the test proves the mount catches that click and asks for a reason,
 * and that nothing is opened without one. `fetch` is faked at the boundary.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "RK", name: "Rowan Kestrel" }, role: "salon_director", isAdmin: false }),
}));

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

const ORIGINAL = "aaaaaaaa-1111-4111-8111-111111111111";
const REVISION = "bbbbbbbb-2222-4222-8222-222222222222";

const DOCUMENT = {
  paper: "letter" as const,
  blocks: [
    { kind: "letterhead" as const, brand: "FORM", title: "Corrective Action Form" },
    { kind: "field" as const, field: { key: "observation", label: "Observation", input: "long_text" as const, responsibility: "ai" as const } },
  ],
};

function loaded(id: string, status: "draft" | "finalized" | "revised", revisesInstanceId: string | null = null) {
  return {
    instance: {
      id,
      templateName: "Corrective Action Form",
      templateVersion: 7,
      templateVersionId: "ver-7",
      variantKey: null,
      employeeName: "Marisol Quenby",
      locationId: "loc-0310",
      locationName: null,
      source: "manual",
      status,
      followUpDate: null,
      revisesInstanceId,
    },
    version: { document: DOCUMENT, variants: [] },
    values: [{ fieldKey: "observation", value: "Arrived late.", checked: [], filledBy: "manager" }],
    events: [{ kind: "created", actor: "manager-1", createdAt: "2026-10-20T15:00:00Z" }],
  };
}

const entry = (id: string, revisionNumber: number, status: string, reason: string | null = null) => ({
  id,
  reference: id.slice(0, 8),
  status,
  revisionNumber,
  kind: revisionNumber === 0 ? null : "revised",
  reason,
  openedAt: "2026-10-20T15:00:00Z",
  openedBy: "manager-1",
  finalizedAt: status === "draft" ? null : "2026-10-21T15:00:00Z",
  supersededAt: null,
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let histories: Record<string, unknown> = {};
let instances: Record<string, unknown> = {};

beforeEach(() => {
  calls = [];
  histories = {};
  instances = {};
  push.mockReset();
  replace.mockReset();
  process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED = "true";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
      const history = /^\/api\/forms\/instances\/([^/]+)\/history$/.exec(url);
      if (history) return histories[history[1]!] ? json(histories[history[1]!]) : json({ error: "Not found." }, 404);
      const one = /^\/api\/forms\/instances\/([^/]+)$/.exec(url);
      if (one && method === "GET") return json(instances[one[1]!]);
      if (one && method === "POST" && body?.action === "revise") {
        if (!body.reason) return json({ error: "Editing a finalized form needs a reason.", code: "REVISION_REASON_REQUIRED" }, 400);
        return json({ instance: { id: REVISION, templateName: "Corrective Action Form" } });
      }
      return json({ error: `unexpected ${method} ${url}` }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED;
});

const reference = (instanceId: string): ChatFormInstanceRef => ({ instanceId, proposalId: "prop-1", templateName: "Corrective Action Form" });

function Card({ instanceId, onReplaced }: { instanceId: string; onReplaced: (next: ChatFormInstanceRef) => void }) {
  return (
    <FormRevisionsMount reference={reference(instanceId)} onReplaced={onReplaced}>
      <InlineForm reference={reference(instanceId)} prefill={{ kind: "complete" }} onReplaced={onReplaced} />
    </FormRevisionsMount>
  );
}

describe("the form card's Edit as new draft, with the flag on", () => {
  it("asks for a reason, opens nothing without one, and moves the card to the new draft with it", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    histories[ORIGINAL] = { history: { instanceId: ORIGINAL, entries: [entry(ORIGINAL, 0, "finalized")] }, marks: [], label: null };
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);

    fireEvent.click(await screen.findByRole("button", { name: /Edit as new draft/ }));
    const dialog = await screen.findByTestId("revision-reason-dialog");
    expect(dialog.textContent).toContain("signed again");
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    const open = screen.getByRole("button", { name: /Open new draft/ });
    expect(open).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Reason for the edit/), { target: { value: " . " } });
    expect(open).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText(/Reason for the edit/), { target: { value: "Wrong offense date was entered." } });
    expect(open).toHaveProperty("disabled", false);
    fireEvent.click(open);

    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION })));
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toEqual([
      { url: `/api/forms/instances/${ORIGINAL}`, method: "POST", body: { action: "revise", reason: "Wrong offense date was entered." } },
    ]);
  });

  it("lets the click through when a revision is already open: no second reason", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    histories[ORIGINAL] = {
      history: { instanceId: ORIGINAL, entries: [entry(ORIGINAL, 0, "finalized"), entry(REVISION, 1, "draft", "Wrong date.")] },
      marks: [],
      label: null,
    };
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByTestId("form-revision-marks");
    fireEvent.click(await screen.findByRole("button", { name: /Edit as new draft/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(screen.queryByTestId("revision-reason-dialog")).toBeNull();
  });

  it("shows Revision N of <ref>, the marks, View previous and the history with the reason", async () => {
    instances[REVISION] = loaded(REVISION, "finalized", ORIGINAL);
    histories[REVISION] = {
      history: { instanceId: REVISION, entries: [entry(ORIGINAL, 0, "revised"), entry(REVISION, 1, "finalized", "Wrong offense date.")] },
      marks: [{ kind: "revised", date: "2026-10-21", supersedes: "aaaaaaaa" }],
      label: "Revision 1 of aaaaaaaa",
    };
    const onReplaced = vi.fn();
    render(<Card instanceId={REVISION} onReplaced={onReplaced} />);
    const marks = await screen.findByTestId("form-revision-marks");
    expect(marks.textContent).toContain("Revision 1 of aaaaaaaa");
    expect(marks.textContent).toContain("Revised 10/21/2026 (supersedes aaaaaaaa)");
    expect(screen.getAllByTestId("form-revision-entry").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Original · aaaaaaaa · Superseded"),
      expect.stringContaining("Reason: Wrong offense date."),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "View previous" }));
    expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: ORIGINAL }));
  });
});

describe("with the flag off", () => {
  it("renders the card alone, byte for byte, and never asks for a history", async () => {
    delete process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED;
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    const wrapped = render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByRole("button", { name: /Edit as new draft/ });
    const withMount = wrapped.container.innerHTML;
    cleanup();
    const bare = render(<InlineForm reference={reference(ORIGINAL)} prefill={{ kind: "complete" }} onReplaced={vi.fn()} />);
    await screen.findByRole("button", { name: /Edit as new draft/ });
    expect(withMount).toBe(bare.container.innerHTML);
    expect(calls.some((call) => call.url.endsWith("/history"))).toBe(false);
  });

  it("shows no register Edit or History", () => {
    delete process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED;
    const { container } = render(
      <RegisterRowActions form={{ id: ORIGINAL, status: "finalized", templateShortName: "Corrective Action", employeeName: "Marisol Quenby" }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the forms list row", () => {
  it("Edit asks for the reason and goes to the new draft's form page; History links to the page's history", async () => {
    render(
      <RegisterRowActions form={{ id: ORIGINAL, status: "finalized", templateShortName: "Corrective Action", employeeName: "Marisol Quenby" }} />,
    );
    expect(screen.getByRole("link", { name: /History of the Corrective Action/ }).getAttribute("href")).toBe(
      `${REGISTER_HREF}/${ORIGINAL}#history`,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit the Corrective Action/ }));
    fireEvent.change(await screen.findByLabelText(/Reason for the edit/), { target: { value: "Wrong offense date was entered." } });
    fireEvent.click(screen.getByRole("button", { name: /Open new draft/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`${REGISTER_HREF}/${REVISION}`));
  });

  it("a superseded form offers History only", () => {
    render(<RegisterRowActions form={{ id: ORIGINAL, status: "revised", templateShortName: "Corrective Action", employeeName: "Marisol Quenby" }} />);
    expect(screen.queryByRole("button", { name: /Edit the/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Edit the/ })).toBeNull();
    expect(screen.getByRole("link", { name: /History of the/ })).toBeTruthy();
  });
});
