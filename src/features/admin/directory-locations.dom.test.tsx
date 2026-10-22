// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, Permission, Role } from "@/types";

import { DirectoryScreen, type DirectoryUser } from "./directory-screen";

/**
 * ============================================================================
 * ADDITIONAL LOCATIONS IN THE INVITATION FORM AND THE USER LIST
 * ============================================================================
 *
 * What an administrator sees and what is sent. Nothing here is a boundary —
 * the server validates the same request — these tests protect the form from
 * offering what would be refused, and from sending something other than what
 * was on screen.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { id: "me-1", name: "Me", email: "me@suntancity.test", avatarInitials: "ME" },
    role: "admin" as Role,
    authenticated: true,
    demoMode: false,
    can: (permission: Permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", permission),
    isAdmin: true,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  // jsdom has no layout, and Radix dialogs call these.
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}
let calls: Call[];
let wovenAnswer: unknown;
let wovenStatus: number;
let inviteStatus: number;

beforeEach(() => {
  calls = [];
  wovenAnswer = { status: "not_found" };
  wovenStatus = 200;
  inviteStatus = 201;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      if (url.includes("invite-suggestion")) {
        return new Response(JSON.stringify(wovenAnswer), { status: wovenStatus });
      }
      if (method === "POST" && url.endsWith("/api/admin/users")) {
        const scope = (body?.scope ?? { level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] }) as AccessScope;
        return new Response(
          JSON.stringify({
            user: {
              id: "new-1",
              email: body?.email,
              displayName: body?.displayName,
              role: body?.role,
              status: "invited",
              scope,
              createdAt: "",
              updatedAt: "",
            },
          }),
          { status: inviteStatus },
        );
      }
      if (method === "PATCH") {
        const scope = (body?.scope ?? {}) as AccessScope;
        return new Response(
          JSON.stringify({ user: user({ id: url.split("/").pop(), scope }) }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
});

const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

function user(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: "u-1",
    email: "manager@suntancity.test",
    displayName: "A Manager",
    role: "salon_director",
    status: "active",
    scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The picker's own options — native <select> options share the role. */
const pickerOptions = (dialog: HTMLElement) =>
  within(within(dialog).getByRole("listbox", { name: "Available locations" })).getAllByRole("option");
const pickerOption = (dialog: HTMLElement) => {
  const options = pickerOptions(dialog);
  expect(options).toHaveLength(1);
  return options[0]!;
};
const chips = (dialog: HTMLElement, id = "invite-additional") => within(within(dialog).getByTestId(`${id}-chips`));

async function openInvite() {
  const ui = userEvent.setup();
  render(<DirectoryScreen initialUsers={[user({ id: "admin-1", role: "admin", scope: GLOBAL })]} />);
  await ui.click(screen.getByRole("button", { name: /Invite someone/i }));
  return { ui, dialog: await screen.findByRole("dialog") };
}

describe("the invitation form", () => {
  it("shows Additional locations (optional) directly below Primary area", async () => {
    const { dialog } = await openInvite();
    const primary = within(dialog).getByLabelText("Primary area");
    const additional = within(dialog).getByLabelText(/Additional locations \(optional\)/);
    expect(primary.compareDocumentPosition(additional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And nothing sits between the two fields.
    const labels = [...dialog.querySelectorAll("label")].map((l) => l.textContent);
    const at = labels.findIndex((t) => t?.startsWith("Primary area"));
    expect(labels[at + 1]).toMatch(/Additional locations \(optional\)/);
  });

  it("starts empty, so one location needs no extra step", async () => {
    const { dialog } = await openInvite();
    expect(within(dialog).getByText("None selected")).toBeTruthy();
  });

  it("filters as you type and adds a location as a removable chip", async () => {
    const { ui, dialog } = await openInvite();
    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.type(box, "liberty");
    const options = pickerOptions(dialog);
    expect(options.map((o) => o.textContent)).toEqual(["MO Kansas City Liberty"]);

    await ui.click(options[0]!);
    expect(chips(dialog).getByText("MO Kansas City Liberty")).toBeTruthy();
    expect(within(dialog).queryByText("None selected")).toBeNull();

    await ui.click(within(dialog).getByRole("button", { name: "Remove MO Kansas City Liberty" }));
    expect(within(dialog).getByText("None selected")).toBeTruthy();
  });

  it("never offers the primary location, and never offers a chosen one twice", async () => {
    const { ui, dialog } = await openInvite();
    const primaryName = (within(dialog).getByLabelText("Primary area") as HTMLSelectElement).selectedOptions[0]!.textContent!;
    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    const names = () => pickerOptions(dialog).map((o) => o.textContent);
    expect(names()).not.toContain(primaryName);

    await ui.click(pickerOptions(dialog)[0]!);
    const taken = within(dialog).getByTestId("invite-additional-chips").textContent!;
    await ui.click(box);
    for (const name of names()) expect(taken).not.toContain(name!);
  });

  it("drops an additional location that becomes the primary", async () => {
    const { ui, dialog } = await openInvite();
    const primary = within(dialog).getByLabelText("Primary area") as HTMLSelectElement;
    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.type(box, "Liberty");
    await ui.click(pickerOption(dialog));
    expect(chips(dialog).getByText("MO Kansas City Liberty")).toBeTruthy();

    await ui.selectOptions(primary, "loc-0394");
    expect(within(dialog).queryByRole("button", { name: "Remove MO Kansas City Liberty" })).toBeNull();
  });

  it("sends primary and additional locations as stable ids, with role and scope", async () => {
    const { ui, dialog } = await openInvite();
    await ui.type(within(dialog).getByLabelText("Work email"), "kc.manager@suntancity.com");
    await ui.type(within(dialog).getByLabelText("Full name"), "KC Manager");
    await ui.selectOptions(within(dialog).getByLabelText("Role"), "salon_director");
    await ui.selectOptions(within(dialog).getByLabelText("Primary area"), "loc-0306");

    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    for (const term of ["Liberty", "Lawrence"]) {
      await ui.click(box);
      await ui.type(box, term);
      await ui.click(pickerOption(dialog));
    }

    await ui.click(within(dialog).getByRole("button", { name: /Send invitation/ }));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/users"))!;
    expect(post.body).toEqual({
      email: "kc.manager@suntancity.com",
      displayName: "KC Manager",
      role: "salon_director",
      scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: ["loc-0394", "loc-0468"] },
    });
  });

  it("sends an empty list for somebody with one location", async () => {
    const { ui, dialog } = await openInvite();
    await ui.type(within(dialog).getByLabelText("Work email"), "one@suntancity.com");
    await ui.type(within(dialog).getByLabelText("Full name"), "One Place");
    await ui.click(within(dialog).getByRole("button", { name: /Send invitation/ }));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/users"))!;
    expect((post.body?.scope as AccessScope).alsoCoversAreaIds).toEqual([]);
  });

  it("a global scope hides the field and sends no additional locations", async () => {
    const { ui, dialog } = await openInvite();
    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.click(pickerOptions(dialog)[0]!);

    await ui.selectOptions(within(dialog).getByLabelText("Scope"), "global");
    expect(within(dialog).queryByLabelText(/Additional locations/)).toBeNull();

    await ui.type(within(dialog).getByLabelText("Work email"), "g@suntancity.com");
    await ui.type(within(dialog).getByLabelText("Full name"), "Global Person");
    await ui.click(within(dialog).getByRole("button", { name: /Send invitation/ }));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/users"))!;
    expect(post.body?.scope).toEqual({ level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  });

  it("a regional manager can carry several explicit locations", async () => {
    const { ui, dialog } = await openInvite();
    await ui.selectOptions(within(dialog).getByLabelText("Scope"), "region");
    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.type(box, "Kearney");
    await ui.click(pickerOption(dialog));
    await ui.type(within(dialog).getByLabelText("Work email"), "rm@suntancity.com");
    await ui.type(within(dialog).getByLabelText("Full name"), "Regional");
    await ui.click(within(dialog).getByRole("button", { name: /Send invitation/ }));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/users"))!;
    expect((post.body?.scope as AccessScope).level).toBe("region");
    expect((post.body?.scope as AccessScope).alsoCoversAreaIds).toEqual(["loc-0309"]);
  });
});

describe("Woven suggestions", () => {
  const FOUND = {
    status: "found",
    employee: { name: "Carley Rowe", positionName: "Salon Director", primaryLocationName: "KC Wornall", employmentStatus: "active" },
    suggestion: {
      displayName: "Carley Rowe",
      role: "salon_director",
      scopeLevel: "salon",
      primaryAreaId: "loc-0306",
      additionalAreaIds: ["loc-0394"],
    },
    notes: ["Not suggested, because they are not matched to an Ask Sunny salon: Brand New Salon."],
  };

  async function typeEmail(dialog: HTMLElement, ui: ReturnType<typeof userEvent.setup>, email: string) {
    await ui.type(within(dialog).getByLabelText("Work email"), email);
    await ui.tab();
  }

  it("shows a match but fills nothing until the administrator applies it", async () => {
    wovenAnswer = FOUND;
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "harper.lyle@suntancity.com");
    await within(dialog).findByText("Found in Woven");

    expect((within(dialog).getByLabelText("Full name") as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText("Role") as HTMLSelectElement).value).toBe("employee");
    expect(within(dialog).getByText("None selected")).toBeTruthy();
    expect(within(dialog).getByText(/Brand New Salon/)).toBeTruthy();
  });

  it("applies the suggestion on request, and every field stays editable", async () => {
    wovenAnswer = FOUND;
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "harper.lyle@suntancity.com");
    await ui.click(await within(dialog).findByRole("button", { name: "Apply suggestions" }));

    expect((within(dialog).getByLabelText("Full name") as HTMLInputElement).value).toBe("Carley Rowe");
    expect((within(dialog).getByLabelText("Role") as HTMLSelectElement).value).toBe("salon_director");
    expect((within(dialog).getByLabelText("Primary area") as HTMLSelectElement).value).toBe("loc-0306");
    expect(chips(dialog).getByText("MO Kansas City Liberty")).toBeTruthy();

    // Override: choose a different role and remove the suggested location.
    await ui.selectOptions(within(dialog).getByLabelText("Role"), "assistant_salon_director");
    await ui.click(within(dialog).getByRole("button", { name: "Remove MO Kansas City Liberty" }));
    await ui.click(within(dialog).getByRole("button", { name: /Send invitation/ }));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/users"))!;
    expect(post.body?.role).toBe("assistant_salon_director");
    expect((post.body?.scope as AccessScope).alsoCoversAreaIds).toEqual([]);
  });

  it("leaves the primary area empty, and blocks sending, when Woven could not supply one", async () => {
    wovenAnswer = {
      ...FOUND,
      suggestion: { ...FOUND.suggestion, role: "district_manager", scopeLevel: "district", primaryAreaId: null, additionalAreaIds: [] },
    };
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "dm@suntancity.com");
    await ui.click(await within(dialog).findByRole("button", { name: "Apply suggestions" }));
    expect((within(dialog).getByLabelText("Primary area") as HTMLSelectElement).value).toBe("");
    expect(within(dialog).getByRole("button", { name: /Send invitation/ }).hasAttribute("disabled")).toBe(true);
  });

  it("says so for an unknown email and leaves the form alone", async () => {
    wovenAnswer = { status: "not_found" };
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "stranger@suntancity.com");
    await within(dialog).findByText(/No employee with this email was found in Woven/);
    expect((within(dialog).getByLabelText("Role") as HTMLSelectElement).value).toBe("employee");
  });

  it("offers nothing to apply when Woven suggests nothing (terminated)", async () => {
    wovenAnswer = { ...FOUND, suggestion: null, notes: ["Woven shows this person as terminated, so nothing is suggested."] };
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "gone@suntancity.com");
    await within(dialog).findByText(/terminated/);
    expect(within(dialog).queryByRole("button", { name: "Apply suggestions" })).toBeNull();
  });

  it("is silent when the lookup is not permitted or fails, and the form still works", async () => {
    wovenStatus = 403;
    wovenAnswer = { error: "no" };
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "someone@suntancity.com");
    await waitFor(() => expect(calls.some((c) => c.url.includes("invite-suggestion"))).toBe(true));
    expect(within(dialog).queryByText("Found in Woven")).toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Send invitation/ })).toBeTruthy();
  });

  it("does not look up something that is not an email address", async () => {
    const { ui, dialog } = await openInvite();
    await typeEmail(dialog, ui, "not-an-email");
    expect(calls.some((c) => c.url.includes("invite-suggestion"))).toBe(false);
  });
});

describe("editing locations after the account exists", () => {
  it("shows additional locations in the list", () => {
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "admin-1", role: "admin", scope: GLOBAL }),
          user({ scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: ["loc-0394", "loc-0468"] } }),
        ]}
      />,
    );
    expect(screen.getByText(/Also: MO Kansas City Liberty, KS Lawrence/)).toBeTruthy();
  });

  it("offers Edit locations to a scoped account but not a global one", () => {
    render(<DirectoryScreen initialUsers={[user({ id: "admin-1", role: "admin", scope: GLOBAL }), user()]} />);
    expect(screen.getAllByRole("button", { name: /Edit locations/ })).toHaveLength(1);
  });

  it("saves only the additional locations, leaving level and primary exactly as they were", async () => {
    const ui = userEvent.setup();
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "admin-1", role: "admin", scope: GLOBAL }),
          user({ scope: { level: "district", primaryAreaId: "dist-cotton-sarah", alsoCoversAreaIds: [] } }),
        ]}
      />,
    );
    await ui.click(screen.getByRole("button", { name: /Edit locations/ }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save locations" });
    expect(save.hasAttribute("disabled")).toBe(true); // unchanged

    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.type(box, "Liberty");
    await ui.click(pickerOption(dialog));
    await ui.click(save);

    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/admin/users/u-1");
    expect(patch.body).toEqual({
      scope: { level: "district", primaryAreaId: "dist-cotton-sarah", alsoCoversAreaIds: ["loc-0394"] },
    });
    expect(patch.body).not.toHaveProperty("role");
    expect(patch.body).not.toHaveProperty("status");
  });

  it("can remove an existing additional location", async () => {
    const ui = userEvent.setup();
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "admin-1", role: "admin", scope: GLOBAL }),
          user({ scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: ["loc-0394", "loc-0468"] } }),
        ]}
      />,
    );
    await ui.click(screen.getByRole("button", { name: /Edit locations/ }));
    const dialog = await screen.findByRole("dialog");
    await ui.click(within(dialog).getByRole("button", { name: "Remove MO Kansas City Liberty" }));
    await ui.click(within(dialog).getByRole("button", { name: "Save locations" }));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect((patch.body?.scope as AccessScope).alsoCoversAreaIds).toEqual(["loc-0468"]);
  });

  it("keeps a district or region already held, instead of dropping it silently", async () => {
    const ui = userEvent.setup();
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "admin-1", role: "admin", scope: GLOBAL }),
          user({
            role: "district_manager",
            scope: { level: "district", primaryAreaId: "dist-cotton-sarah", alsoCoversAreaIds: ["dist-dugan-rachael"] },
          }),
        ]}
      />,
    );
    await ui.click(screen.getByRole("button", { name: /Edit locations/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Dugan, Rachael")).toBeTruthy();

    const box = within(dialog).getByRole("combobox", { name: /Additional locations/ });
    await ui.click(box);
    await ui.type(box, "Liberty");
    await ui.click(pickerOption(dialog));
    await ui.click(within(dialog).getByRole("button", { name: "Save locations" }));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect((patch.body?.scope as AccessScope).alsoCoversAreaIds).toEqual(["dist-dugan-rachael", "loc-0394"]);
  });
});
