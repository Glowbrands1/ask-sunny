// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/overlays";
import { DEFAULT_PERMISSION_MATRIX, effectiveMatrix } from "@/lib/permissions";

import { PermissionsMatrix } from "./permissions-matrix";

/**
 * Tick -> Save -> refresh (Pau, 23 Nov 2026). A fake of the server keeps what
 * was PUT; a fresh render (a page refresh) reads it back through GET and must
 * show exactly what was saved.
 */
const refreshPermissions = vi.fn(async () => null);
vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ authenticated: true, demoMode: false, role: "admin", refreshPermissions }),
}));
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({ permissionMatrix: DEFAULT_PERMISSION_MATRIX, setPermissionMatrix: () => {} }),
}));

let stored: Record<string, string[]> = {};
let putStatus = 200;
const calls: { method: string; body?: unknown }[] = [];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

beforeEach(() => {
  stored = {};
  putStatus = 200;
  calls.length = 0;
  refreshPermissions.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = JSON.parse(String(init!.body)) as { overrides: Record<string, string[]> };
        calls.push({ method, body });
        if (putStatus !== 200) return new Response(JSON.stringify({ error: "Nope." }), { status: putStatus });
        stored = body.overrides;
      } else {
        calls.push({ method });
      }
      return new Response(JSON.stringify({ overrides: stored, matrix: effectiveMatrix(stored) }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () =>
  render(
    <TooltipProvider>
      <PermissionsMatrix />
    </TooltipProvider>,
  );
const box = (label: string) => screen.getByRole("checkbox", { name: label }) as HTMLButtonElement;
const checked = (label: string) => box(label).getAttribute("aria-checked") === "true";

describe("the permissions matrix: tick, save, refresh", () => {
  it("one tick is one change, counted, and nothing is sent until Save", async () => {
    mount();
    await screen.findByText("No unsaved changes");
    expect(checked("View Google reviews for Employee")).toBe(false);

    fireEvent.click(box("View Google reviews for Employee"));
    expect(checked("View Google reviews for Employee")).toBe(true);
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
    fireEvent.click(box("Manage training videos for Salon Director"));
    expect(screen.getByText("2 unsaved changes")).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("clicking anywhere in the cell ticks the box", async () => {
    mount();
    await screen.findByText("No unsaved changes");
    const label = box("View Google reviews for Employee").closest("label")!;
    fireEvent.click(label);
    expect(checked("View Google reviews for Employee")).toBe(true);
  });

  it("Discard returns to what is saved", async () => {
    mount();
    await screen.findByText("No unsaved changes");
    fireEvent.click(box("View Google reviews for Employee"));
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));
    expect(checked("View Google reviews for Employee")).toBe(false);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("Save sends the changed role, says so, refreshes the session, and a refresh shows the same boxes", async () => {
    const first = mount();
    await screen.findByText("No unsaved changes");
    fireEvent.click(box("View Google reviews for Employee"));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await screen.findByText(/These permissions are now in force/);
    const sent = (calls.find((call) => call.method === "PUT")!.body as { overrides: Record<string, string[]> }).overrides;
    expect(Object.keys(sent)).toEqual(["employee"]);
    expect([...sent.employee!].sort()).toEqual(
      ["ask_questions", "view_knowledge", "view_videos", "view_ai_training", "view_google_reviews"].sort(),
    );
    expect(refreshPermissions).toHaveBeenCalled();
    expect(screen.getByText("No unsaved changes")).toBeTruthy();

    // The page is refreshed: a new screen reads the server and shows what is enforced.
    first.unmount();
    mount();
    await screen.findByText("No unsaved changes");
    expect(checked("View Google reviews for Employee")).toBe(true);
    expect(checked("View Google reviews for Salon Director")).toBe(true);
    expect(checked("Open Manager Resources for Employee")).toBe(false);
  });

  it("Reset to defaults is a draft until saved, and saving it clears the stored change", async () => {
    stored = { employee: ["ask_questions"] };
    mount();
    await screen.findByText("No unsaved changes");
    expect(checked("Read the knowledge base for Employee")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/ }));
    expect(checked("Read the knowledge base for Employee")).toBe(true);
    expect(screen.getByText(/unsaved change/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(stored).toEqual({}));
  });

  it("a refused save keeps the draft and shows the server's reason", async () => {
    putStatus = 400;
    mount();
    await screen.findByText("No unsaved changes");
    fireEvent.click(box("View Google reviews for Employee"));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await screen.findByText("Nope.");
    expect(checked("View Google reviews for Employee")).toBe(true);
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("locked cells cannot be ticked, and admin columns are always on", async () => {
    mount();
    await screen.findByText("No unsaved changes");
    expect(box("Manage users for Salon Director").disabled).toBe(true);
    expect(box("Manage users for Admin").disabled).toBe(true);
    expect(checked("Manage users for Admin")).toBe(true);
    expect(box("View AI usage & spend for Salon Director").disabled).toBe(true);
    // The Regional Manager holds it by default, so it can be taken away.
    expect(box("View AI usage & spend for Regional Manager").disabled).toBe(false);
    fireEvent.click(box("Manage users for Salon Director"));
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("role columns carry the full role name", async () => {
    mount();
    await screen.findByText("No unsaved changes");
    expect(screen.getByRole("columnheader", { name: "Assistant Salon Director" })).toBeTruthy();
  });

  it("when the saved matrix cannot be read, editing is switched off rather than saving over it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    mount();
    await screen.findByText(/could not be loaded/);
    expect(box("View Google reviews for Employee").disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
