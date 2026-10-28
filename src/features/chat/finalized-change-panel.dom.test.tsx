// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineForm } from "@/features/chat/inline-form";
import type { ChatFormInstanceRef, Permission, Role } from "@/types";

import { FormRevisionsMount } from "@/form-revisions/form-revisions-mount";

/**
 * ============================================================================
 * "CHANGE SOMETHING" ON A FINALIZED FORM (NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED)
 * ============================================================================
 *
 * Pau, 28 Oct 2026: structured changes to a finalized form, no chat turn. The
 * card is the real `InlineForm`; `fetch` is faked at the boundary, so each test
 * proves which requests go out: the revision (with a reason when the server
 * asks for one), then one save of only the changed values onto the new draft.
 * Never a write to the finalized form. Names are invented.
 */

/*
 * The signed-in role, and what it may do read from the real permission
 * matrix, so "may this role edit that form" is the same answer the server's
 * `authorizeInstance(..., "edit")` gives.
 */
const session = vi.hoisted(() => ({ role: "salon_director" as string, demoMode: false }));
vi.mock("@/lib/session/session-context", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    useSession: () => ({
      user: { avatarInitials: "RK", name: "Rowan Kestrel" },
      role: session.role,
      isAdmin: false,
      demoMode: session.demoMode,
      can: (permission: Permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, session.role as Role, permission),
    }),
  };
});

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));


const ORIGINAL = "aaaaaaaa-1111-4111-8111-111111111111";
const REVISION = "bbbbbbbb-2222-4222-8222-222222222222";
const FLAG = "NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED";

const CA_DOCUMENT = {
  paper: "letter" as const,
  blocks: [
    { kind: "letterhead" as const, brand: "FORM", title: "Corrective Action Form" },
    { kind: "field" as const, field: { key: "form_date", label: "Date", input: "date" as const, responsibility: "system" as const } },
    {
      kind: "checkbox_group" as const,
      key: "warning_type",
      options: [
        { key: "verbal", label: "Verbal Warning" },
        { key: "written", label: "Written Warning" },
      ],
      responsibility: "ai" as const,
    },
    {
      kind: "checkbox_group" as const,
      key: "payroll_deduct",
      options: [
        { key: "yes", label: "Yes" },
        { key: "no", label: "No" },
      ],
      responsibility: "manager" as const,
      single: true,
    },
  ],
};

function loaded(id: string, status: "draft" | "finalized" | "revised", templateName = "Corrective Action Form") {
  return {
    instance: {
      id,
      templateName,
      templateVersion: 7,
      templateVersionId: "ver-7",
      variantKey: null,
      employeeName: "Quinn Marlowe",
      locationId: "loc-0309",
      locationName: null,
      source: "manual",
      status,
      followUpDate: null,
      revisesInstanceId: null,
    },
    version: { document: CA_DOCUMENT, variants: [] },
    values: [
      { fieldKey: "form_date", value: "2026-10-20", checked: [], filledBy: "manager" },
      { fieldKey: "warning_type", value: null, checked: ["verbal"], filledBy: "manager" },
      { fieldKey: "payroll_deduct", value: null, checked: ["no"], filledBy: "manager" },
    ],
    events: [{ kind: "created", actor: "manager-1", createdAt: "2026-10-20T15:00:00Z" }],
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let instances: Record<string, unknown> = {};
let reasonRequired = false;
let rejected: { key: string; reason: string }[] = [];
let planRebuilt = false;

beforeEach(() => {
  calls = [];
  instances = {};
  reasonRequired = false;
  rejected = [];
  planRebuilt = false;
  session.role = "salon_director";
  session.demoMode = false;
  process.env[FLAG] = "true";
  delete process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
      if (/\/history$/.test(url)) return json({ error: "Not found." }, 404);
      const one = /^\/api\/forms\/instances\/([^/]+)$/.exec(url);
      if (one && method === "GET") return json(instances[one[1]!]);
      if (one && method === "POST" && body?.action === "revise") {
        if (reasonRequired && !body.reason) return json({ error: "Editing a finalized form needs a reason.", code: "REVISION_REASON_REQUIRED" }, 400);
        return json({ instance: { id: REVISION, templateName: "Corrective Action Form" } });
      }
      if (one && method === "PATCH" && one[1] === REVISION) return json({ ...(instances[REVISION] as object), rejected, ...(planRebuilt ? { actionPlanRebuilt: true } : {}) });
      return json({ error: `unexpected ${method} ${url}` }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env[FLAG];
  delete process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED;
});

const reference = (instanceId: string, templateName = "Corrective Action Form"): ChatFormInstanceRef => ({ instanceId, proposalId: "prop-1", templateName });

function Card({ instanceId, onReplaced }: { instanceId: string; onReplaced: (next: ChatFormInstanceRef) => void }) {
  return (
    <FormRevisionsMount reference={reference(instanceId)} onReplaced={onReplaced}>
      <InlineForm reference={reference(instanceId)} prefill={{ kind: "complete" }} onReplaced={onReplaced} />
    </FormRevisionsMount>
  );
}

async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: /Change something/ }));
}

const panel = () => within(document.querySelector<HTMLElement>("[data-finalized-change]")!);

const writes = () => calls.filter((call) => call.method !== "GET");

describe("where the button is", () => {
  it("flag off: no button on a finalized form (as main)", async () => {
    delete process.env[FLAG];
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByRole("button", { name: /Edit as new draft/ });
    expect(screen.queryByRole("button", { name: /Change something/ })).toBeNull();
  });

  it("beside Edit as new draft on a finalized form; Edit stays", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Change something/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit as new draft/ })).toBeTruthy();
  });

  it("not on a draft (it has its own editor)", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "draft");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByText(/Quinn Marlowe/);
    expect(screen.queryByRole("button", { name: /Change something/ })).toBeNull();
  });

  it("not on a revised form", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "revised");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByText(/Quinn Marlowe/);
    expect(screen.queryByRole("button", { name: /Change something/ })).toBeNull();
  });

  it("not for a role that may not edit the form", async () => {
    session.role = "assistant_salon_director";
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await screen.findByText(/Quinn Marlowe/);
    expect(screen.queryByRole("button", { name: /Change something/ })).toBeNull();
  });
});

describe("what Send does", () => {
  it("prefills the form's values; nothing changed sends nothing", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await openPanel();
    expect((panel().getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-20");
    expect((panel().getByLabelText("Type of warning") as HTMLSelectElement).value).toBe("verbal");
    expect((panel().getByLabelText("Payroll deduct") as HTMLSelectElement).value).toBe("no");
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect(screen.getByRole("alert").textContent).toBe("Nothing is changed yet.");
    expect(writes()).toEqual([]);
  });

  it("revisions off: opens the revision without a reason, saves only the changed values on the new draft, shows the draft", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Date"), { target: { value: "2026-10-19" } });
    fireEvent.change(panel().getByLabelText("Type of warning"), { target: { value: "written" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION })));
    expect(writes()).toEqual([
      { url: `/api/forms/instances/${ORIGINAL}`, method: "POST", body: { action: "revise" } },
      { url: `/api/forms/instances/${REVISION}`, method: "PATCH", body: { values: { form_date: "2026-10-19" }, checked: { warning_type: ["written"] }, source: "card-change" } },
    ]);
  });

  it("revisions on: the same reason dialog first, then the revision with the reason", async () => {
    process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED = "true";
    reasonRequired = true;
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Date"), { target: { value: "2026-10-19" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    await screen.findByTestId("revision-reason-dialog");
    expect(writes()).toEqual([]);
    fireEvent.change(screen.getByLabelText(/Reason for the edit/), { target: { value: "Wrong offense date was entered." } });
    fireEvent.click(screen.getByRole("button", { name: /Open new draft/ }));
    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION })));
    expect(writes()[0]).toEqual({ url: `/api/forms/instances/${ORIGINAL}`, method: "POST", body: { action: "revise", reason: "Wrong offense date was entered." } });
    expect(writes()[1]?.body).toEqual({ values: { form_date: "2026-10-19" }, checked: {}, source: "card-change" });
  });

  it("server asks for a reason though the browser flag is off: the dialog is shown, never a dead end", async () => {
    reasonRequired = true;
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Date"), { target: { value: "2026-10-19" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    await screen.findByTestId("revision-reason-dialog");
    fireEvent.change(screen.getByLabelText(/Reason for the edit/), { target: { value: "Wrong offense date was entered." } });
    fireEvent.click(screen.getByRole("button", { name: /Open new draft/ }));
    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION })));
  });

  it("payroll changed: the draft is open and the manager is told to check the Action Plan", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Payroll deduct"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect((await screen.findByRole("status")).textContent).toContain("check the Action Plan");
    expect(writes()[1]?.body).toEqual({ values: {}, checked: { payroll_deduct: ["yes"] }, source: "card-change" });
    fireEvent.click(screen.getByRole("button", { name: "Open the new draft" }));
    expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION }));
  });

  it("a value the draft refused is said, not hidden", async () => {
    rejected = [{ key: "warning_type", reason: "not a field on this template version" }];
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    render(<Card instanceId={ORIGINAL} onReplaced={vi.fn()} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Type of warning"), { target: { value: "written" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect((await screen.findByRole("status")).textContent).toContain("did not save: warning_type");
  });

  it("a form without a type of warning offers the date only", async () => {
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized", "Coaching Form");
    render(
      <InlineForm reference={reference(ORIGINAL, "Coaching Form")} prefill={{ kind: "complete" }} onReplaced={vi.fn()} />,
    );
    await openPanel();
    expect(panel().getByLabelText("Date")).toBeTruthy();
    expect(panel().queryByLabelText("Type of warning")).toBeNull();
    expect(panel().queryByLabelText("Payroll deduct")).toBeNull();
  });

  it("payroll changed and the server rebuilt the Action Plan (CARD_CHANGE_PLAN_REBUILD_ENABLED): no notice, straight to the draft", async () => {
    planRebuilt = true;
    instances[ORIGINAL] = loaded(ORIGINAL, "finalized");
    instances[REVISION] = loaded(REVISION, "draft");
    const onReplaced = vi.fn();
    render(<Card instanceId={ORIGINAL} onReplaced={onReplaced} />);
    await openPanel();
    fireEvent.change(panel().getByLabelText("Payroll deduct"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send change" }));
    await waitFor(() => expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ instanceId: REVISION })));
    expect(screen.queryByText(/check the Action Plan/)).toBeNull();
  });
});

