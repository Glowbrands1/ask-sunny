// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MonitoringTable, type MonitoredForm } from "./monitoring-table";

/**
 * WHAT THE TABLE OFFERS, PER ROW.
 *
 * The rule is decided by status and must be visible in the markup, not only
 * enforced on the server: a draft offers Delete, and anything finalized or
 * revised offers Archive INSTEAD — never a Delete that the server will refuse
 * after somebody has confirmed it.
 *
 * The confirmation has to name the record. "Are you sure?" is a dialog people
 * learn to dismiss, so the employee, the form and the status are asserted here.
 */

const navigated = vi.hoisted(() => ({ pushes: [] as string[], refreshes: 0 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => navigated.pushes.push(url),
    refresh: () => {
      navigated.refreshes += 1;
    },
  }),
}));

const mockSession = vi.hoisted(() => ({
  value: {
    role: "owner",
    user: { name: "QA" },
    can: () => true,
    demoMode: true,
  } as unknown,
}));
vi.mock("@/lib/session/session-context", () => ({ useSession: () => mockSession.value }));

const calls = vi.hoisted(() => ({ list: [] as { url: string; method: string }[] }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.list.push({ url: String(input), method: init?.method ?? "GET" });
    return Promise.resolve(
      new Response(JSON.stringify({ deleted: { id: "x" }, instance: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  cleanup();
  calls.list = [];
  navigated.pushes = [];
  navigated.refreshes = 0;
});

function form(overrides: Partial<MonitoredForm> = {}): MonitoredForm {
  return {
    id: "form-1",
    templateName: "Policy Review Acknowledgement",
    templateShortName: "Policy Review",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Jordan Vance (test)",
    locationName: "Riverbend Commons",
    createdBy: "demo:salon_director:QA",
    createdByRole: "salon_director",
    source: "manual",
    status: "draft",
    formDate: "2026-09-01",
    followUpDate: null,
    finalizedAt: null,
    exportedAt: null,
    revisesInstanceId: null,
    archivedAt: null,
    isDemo: true,
    updatedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function table(forms: MonitoredForm[], demo = { deletable: 0, protected: 0 }) {
  return render(
    <MonitoringTable forms={forms} notice={null} view="active" demo={demo} />,
  );
}

function rowFor(name: string) {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
}

describe("what each row offers", () => {
  it("offers Delete on a draft", () => {
    table([form()]);
    const row = rowFor("Jordan Vance (test)");
    expect(row.getByRole("button", { name: /delete/i })).toBeTruthy();
    expect(row.queryByRole("button", { name: /archive/i })).toBeNull();
  });

  it("offers Archive INSTEAD OF Delete on a finalized form", () => {
    table([form({ employeeName: "Sam Okafor", status: "finalized" })]);
    const row = rowFor("Sam Okafor");
    expect(row.getByRole("button", { name: /archive/i })).toBeTruthy();
    // The load-bearing half: no Delete the server would refuse.
    expect(row.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("offers Archive on a revised form too", () => {
    table([form({ employeeName: "Ada Reyes", status: "revised" })]);
    expect(rowFor("Ada Reyes").queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("offers Restore, not Delete, on an archived row", () => {
    table([form({ employeeName: "Lee Park", archivedAt: "2026-09-03T10:00:00Z" })]);
    const row = rowFor("Lee Park");
    expect(row.getByRole("button", { name: /restore/i })).toBeTruthy();
    expect(row.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("shows nothing but the PDF when the viewer may not manage records", () => {
    mockSession.value = { role: "salon_director", user: { name: "QA" }, can: () => false, demoMode: false };
    table([form()]);
    const row = rowFor("Jordan Vance (test)");
    expect(row.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(row.getByRole("button", { name: /pdf/i })).toBeTruthy();
    mockSession.value = { role: "owner", user: { name: "QA" }, can: () => true, demoMode: true };
  });
});

describe("confirming a delete", () => {
  it("names the employee, the form and the status before destroying anything", async () => {
    table([form()]);
    await userEvent.click(rowFor("Jordan Vance (test)").getByRole("button", { name: /delete/i }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Delete this form?")).toBeTruthy();
    expect(dialog.getByText("Jordan Vance (test)")).toBeTruthy();
    expect(dialog.getByText("Policy Review Acknowledgement")).toBeTruthy();
    expect(dialog.getByText("draft")).toBeTruthy();
    expect(dialog.getByText(/removes the form instance and its draft data/i)).toBeTruthy();

    // Nothing has been sent yet — opening the dialog is not the action.
    expect(calls.list).toHaveLength(0);
  });

  it("sends the delete only after the confirmation is accepted", async () => {
    table([form()]);
    await userEvent.click(rowFor("Jordan Vance (test)").getByRole("button", { name: /delete/i }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]).toEqual({ url: "/api/forms/instances/form-1", method: "DELETE" });
    expect(navigated.refreshes).toBe(1);
  });

  it("sends nothing when it is cancelled", async () => {
    table([form()]);
    await userEvent.click(rowFor("Jordan Vance (test)").getByRole("button", { name: /delete/i }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: /cancel/i }));

    expect(calls.list).toHaveLength(0);
  });
});

describe("the bulk sweep", () => {
  it("stays hidden when there is nothing positively identifiable to remove", () => {
    table([form({ createdBy: "auth0|4821", isDemo: false })], { deletable: 0, protected: 0 });
    expect(screen.queryByRole("button", { name: /delete test forms/i })).toBeNull();
  });

  it("states the count, and that names are not what it matches on", async () => {
    table([form()], { deletable: 6, protected: 1 });
    await userEvent.click(screen.getByRole("button", { name: /delete test forms/i }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Delete 6 demo forms?")).toBeTruthy();
    expect(dialog.getByText(/permanently remove 6 synthetic Forms records/i)).toBeTruthy();
    expect(dialog.getByText(/not on the employee/i)).toBeTruthy();
    // The finalized demo forms are reported as kept, not swept.
    expect(dialog.getByText(/1 finalized demo form is kept/i)).toBeTruthy();
    expect(dialog.getByRole("button", { name: /delete 6 test forms/i })).toBeTruthy();
  });

  it("sends the count it showed, so a changed list aborts server-side", async () => {
    table([form()], { deletable: 6, protected: 0 });
    await userEvent.click(screen.getByRole("button", { name: /delete test forms/i }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: /delete 6 test forms/i }));

    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0].url).toBe("/api/forms/instances?scope=demo&expected=6");
    expect(calls.list[0].method).toBe("DELETE");
  });
});

describe("the view filter", () => {
  it("re-reads on the server, because archived rows are not on this page", async () => {
    table([form()]);
    await userEvent.selectOptions(screen.getByLabelText("Show"), "archived");
    expect(navigated.pushes).toEqual(["/forms/monitoring?view=archived"]);
  });

  it("returns to the plain URL for the active list", async () => {
    render(<MonitoringTable forms={[form()]} notice={null} view="all" demo={{ deletable: 0, protected: 0 }} />);
    await userEvent.selectOptions(screen.getByLabelText("Show"), "active");
    expect(navigated.pushes).toEqual(["/forms/monitoring"]);
  });
});
