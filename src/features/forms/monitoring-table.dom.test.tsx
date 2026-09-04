// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MonitoringTable, type MonitoredForm } from "./monitoring-table";

/**
 * WHAT THE TABLE OFFERS, AND WHAT IT SAYS ABOUT EACH ROW.
 *
 * Two rules are asserted over and over because both have already been got
 * wrong in this project:
 *
 *   the STATE IS DERIVED from the follow-up fields and the business date passed
 *   in — never from a stored string, and never from the browser's own clock;
 *
 *   the DOCUMENT'S LIFECYCLE and the FOLLOW-UP STATE are different things. A
 *   draft can be overdue. A finalized form can be followed up. Neither may be
 *   labelled with the other's word.
 */

const TODAY = "2026-09-04";

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

const calls = vi.hoisted(() => ({
  list: [] as { url: string; method: string; body: unknown }[],
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.list.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ instance: {}, deleted: { id: "x" } }), {
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
  mockSession.value = { role: "owner", user: { name: "QA" }, can: () => true, demoMode: true };
});

function form(overrides: Partial<MonitoredForm> = {}): MonitoredForm {
  return {
    id: "form-1",
    templateName: "Coaching Form",
    templateShortName: "Coaching",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Jordan Vance (test)",
    locationName: "Riverbend Commons",
    createdBy: "demo:salon_director:QA",
    createdByRole: "salon_director",
    source: "manual",
    status: "finalized",
    formDate: "2026-09-01",
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: "2026-09-01T12:00:00Z",
    exportedAt: null,
    revisesInstanceId: null,
    archivedAt: null,
    isDemo: true,
    updatedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

const NO_ATTENTION = { overdue: 0, dueThisWeek: 0, needsAttention: 0 };

function table(
  forms: MonitoredForm[],
  options: {
    followUp?: "all" | "drafted" | "open" | "overdue" | "followed_up";
    view?: "active" | "archived" | "all";
    attention?: { overdue: number; dueThisWeek: number; needsAttention: number };
    demo?: { deletable: number; protected: number };
  } = {},
) {
  return render(
    <MonitoringTable
      forms={forms}
      notice={null}
      view={options.view ?? "active"}
      followUp={options.followUp ?? "all"}
      today={TODAY}
      attention={options.attention ?? NO_ATTENTION}
      demo={options.demo ?? { deletable: 0, protected: 0 }}
    />,
  );
}

function rowFor(name: string) {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return { row, ui: within(row) };
}

/* ------------------------------------------------------------ the counts --- */

describe("the follow-up pills", () => {
  const mixed = [
    form({ id: "d1", employeeName: "Drafted One", status: "draft" }),
    form({ id: "o1", employeeName: "Open One", followUpDate: "2026-09-10" }),
    form({ id: "o2", employeeName: "Due Today", followUpDate: TODAY }),
    form({ id: "l1", employeeName: "Late One", followUpDate: "2026-09-01" }),
    form({
      id: "f1",
      employeeName: "Done One",
      followUpDate: "2026-08-20",
      followedUpAt: "2026-08-21T10:00:00Z",
      followedUpBy: "demo:owner:QA",
    }),
  ];

  function pill(label: string) {
    return screen.getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) });
  }

  it("counts live rows, with no fixed numbers anywhere", () => {
    table(mixed);
    expect(pill("All").textContent).toBe("All5");
    expect(pill("Drafted").textContent).toBe("Drafted1");
    expect(pill("Open").textContent).toBe("Open2");
    expect(pill("Overdue").textContent).toBe("Overdue1");
    expect(pill("Followed up").textContent).toBe("Followed up1");
  });

  it("keeps counting every state while one is selected", () => {
    // Otherwise choosing Overdue would leave the other pills reading zero and
    // the manager could not see what else is waiting.
    table(mixed, { followUp: "overdue" });
    expect(pill("Open").textContent).toBe("Open2");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + the late one
  });

  it("filters to exactly the selected state", () => {
    table(mixed, { followUp: "followed_up" });
    expect(screen.getByText("Done One")).toBeTruthy();
    expect(screen.queryByText("Late One")).toBeNull();
  });

  it("puts the choice in the URL, so it can be linked to and survives a refresh", async () => {
    table(mixed);
    await userEvent.click(pill("Overdue"));
    expect(navigated.pushes).toEqual(["/forms/monitoring?followup=overdue"]);
  });

  it("keeps the archive shelf when the pill changes, and vice versa", async () => {
    table(mixed, { view: "archived", followUp: "all" });
    await userEvent.click(pill("Open"));
    expect(navigated.pushes).toEqual(["/forms/monitoring?view=archived&followup=open"]);
  });

  it("says nothing is in an empty state rather than showing 'no forms yet'", () => {
    table([form({ employeeName: "Only Draft", status: "draft" })], { followUp: "overdue" });
    expect(screen.getByText("Nothing is overdue.")).toBeTruthy();
  });
});

/* ------------------------------------------------------------- the colour --- */

describe("how each state is coloured", () => {
  /*
   * #ef6079 IS `--followup-attention`, and the badge is asserted through the
   * semantic token rather than the hex: a test that greps for the hex would
   * pass on a hard-coded colour, which is exactly what the design system
   * forbids. The token's value is checked separately, once, below.
   */
  it("gives OVERDUE the filled follow-up pink", () => {
    table([form({ employeeName: "Late One", followUpDate: "2026-09-01" })]);
    const badge = rowFor("Late One").ui.getByText("Overdue");
    expect(badge.className).toContain("bg-followup-attention");
    expect(badge.className).toContain("text-followup-attention-foreground");
  });

  it("does NOT make an upcoming follow-up pink", () => {
    table([form({ employeeName: "Open One", followUpDate: "2026-09-10" })]);
    const badge = rowFor("Open One").ui.getByText("Open");
    expect(badge.className).not.toContain("followup");
  });

  it("gives a completed follow-up the success treatment, not pink", () => {
    table([
      form({
        employeeName: "Done One",
        followUpDate: "2026-08-20",
        followedUpAt: "2026-08-21T10:00:00Z",
      }),
    ]);
    const badge = rowFor("Done One").ui.getByText("Followed up");
    expect(badge.className).toContain("status-ready");
    expect(badge.className).not.toContain("followup");
  });

  it("resolves that token to the approved #ef6079", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/--approved-followup:\s*#ef6079/);
    expect(css).toMatch(/--followup-attention:\s*var\(--approved-followup\)/);
    expect(css).toMatch(/--followup-attention-foreground:\s*#ffffff/);
  });
});

/* ---------------------------------------------------------- the two states --- */

describe("the document's lifecycle stays separate from the follow-up's", () => {
  it("shows a draft that is overdue as OVERDUE, and still says it is a draft", () => {
    table([form({ employeeName: "Late Draft", status: "draft", followUpDate: "2026-09-01" })]);
    const { ui } = rowFor("Late Draft");
    expect(ui.getByText("Overdue")).toBeTruthy();
    // The lifecycle rides along under the form name rather than competing for
    // the status column.
    expect(ui.getByText(/v1 · draft/)).toBeTruthy();
  });

  it("shows an untracked draft as Drafted", () => {
    table([form({ employeeName: "Plain Draft", status: "draft" })]);
    expect(rowFor("Plain Draft").ui.getByText("Drafted")).toBeTruthy();
  });

  it("shows a finalized form nobody scheduled as Not tracked", () => {
    table([form({ employeeName: "Filed One" })]);
    expect(rowFor("Filed One").ui.getByText("Not tracked")).toBeTruthy();
  });
});

/* --------------------------------------------------------------- the flows --- */

describe("start tracking", () => {
  it("offers it on a form with no follow-up date, and invents no date", async () => {
    table([form({ employeeName: "Filed One" })]);
    const { ui } = rowFor("Filed One");
    await userEvent.click(ui.getByRole("button", { name: /start tracking/i }));

    const input = ui.getByLabelText("Follow-up date for Filed One") as HTMLInputElement;
    expect(input.type).toBe("date");
    // NOTHING is chosen for the manager, and nothing is sent until they choose.
    expect(input.value).toBe("");
    expect(calls.list).toHaveLength(0);
  });

  it("persists the date the manager picks", async () => {
    table([form({ employeeName: "Filed One" })]);
    const { ui } = rowFor("Filed One");
    await userEvent.click(ui.getByRole("button", { name: /start tracking/i }));
    const input = ui.getByLabelText("Follow-up date for Filed One");
    await userEvent.type(input, "2026-09-10");

    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]).toMatchObject({
      url: "/api/forms/instances/form-1/follow-up",
      method: "PUT",
      body: { date: "2026-09-10" },
    });
    expect(navigated.refreshes).toBe(1);
  });

  it("is not offered on an archived form", () => {
    table([form({ employeeName: "Hidden One", archivedAt: "2026-09-02T00:00:00Z" })], {
      view: "archived",
    });
    expect(
      rowFor("Hidden One").ui.queryByRole("button", { name: /start tracking/i }),
    ).toBeNull();
  });
});

describe("changing the date", () => {
  it("saves on change, with no Save button to forget", async () => {
    table([form({ employeeName: "Open One", followUpDate: "2026-09-10" })]);
    const input = rowFor("Open One").ui.getByLabelText("Follow-up date for Open One");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-09-03");

    await waitFor(() => expect(calls.list.at(-1)?.body).toEqual({ date: "2026-09-03" }));
    expect(calls.list.at(-1)?.method).toBe("PUT");
  });

  it("shows how far off the date is, measured against the business date given", () => {
    table([form({ employeeName: "Open One", followUpDate: "2026-09-05" })]);
    expect(rowFor("Open One").ui.getByText("Tomorrow")).toBeTruthy();
  });

  it("sends nothing when the box is cleared — un-tracking is not an action", async () => {
    table([form({ employeeName: "Open One", followUpDate: "2026-09-10" })]);
    const input = rowFor("Open One").ui.getByLabelText("Follow-up date for Open One");
    await userEvent.clear(input);
    expect(calls.list).toHaveLength(0);
  });
});

describe("mark followed up", () => {
  it("is offered on an outstanding follow-up and completes it", async () => {
    table([form({ employeeName: "Late One", followUpDate: "2026-09-01" })]);
    await userEvent.click(
      rowFor("Late One").ui.getByRole("button", { name: /mark followed up/i }),
    );

    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]).toMatchObject({
      url: "/api/forms/instances/form-1/follow-up",
      method: "POST",
      body: { action: "complete" },
    });
  });

  it("is not offered on a form nobody scheduled", () => {
    table([form({ employeeName: "Filed One" })]);
    expect(
      rowFor("Filed One").ui.queryByRole("button", { name: /mark followed up/i }),
    ).toBeNull();
  });

  it("is gone once it is done, and the scheduled date is still shown", () => {
    table([
      form({
        employeeName: "Done One",
        followUpDate: "2026-08-20",
        followedUpAt: "2026-08-21T10:00:00Z",
      }),
    ]);
    const { ui } = rowFor("Done One");
    expect(ui.queryByRole("button", { name: /mark followed up/i })).toBeNull();
    // What was scheduled and when it happened are both readable.
    expect(ui.getByText("Aug 20, 2026")).toBeTruthy();
    expect(ui.getByText(/done Aug 21, 2026/)).toBeTruthy();
  });

  it("offers an audited reopen instead", async () => {
    table([
      form({
        employeeName: "Done One",
        followUpDate: "2026-08-20",
        followedUpAt: "2026-08-21T10:00:00Z",
      }),
    ]);
    await userEvent.click(
      rowFor("Done One").ui.getByRole("button", { name: /more actions/i }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: /reopen follow-up/i }));

    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0].body).toEqual({ action: "reopen" });
  });
});

/* -------------------------------------------------------------- the banner --- */

describe("the attention banner", () => {
  it("states the live counts the server passed in", () => {
    table([form({ employeeName: "Late One", followUpDate: "2026-09-01" })], {
      attention: { overdue: 8, dueThisWeek: 4, needsAttention: 12 },
    });
    expect(
      screen.getByText("12 follow-ups need attention — 8 overdue · 4 due this week"),
    ).toBeTruthy();
  });

  it("is absent when nothing needs attention", () => {
    table([form({ employeeName: "Filed One" })]);
    expect(screen.queryByText(/need.* attention/)).toBeNull();
  });

  it("still shows on the Followed up shelf, where the rows cannot tell you", () => {
    // The banner counts the ACTIVE set on the server, not the filtered rows.
    table(
      [
        form({
          employeeName: "Done One",
          followUpDate: "2026-08-20",
          followedUpAt: "2026-08-21T10:00:00Z",
        }),
      ],
      { followUp: "followed_up", attention: { overdue: 3, dueThisWeek: 0, needsAttention: 3 } },
    );
    expect(screen.getByText("3 follow-ups need attention — 3 overdue")).toBeTruthy();
  });
});

/* ------------------------------------------------ delete / archive regression --- */

describe("delete and archive still work as they did", () => {
  async function openMenu(name: string) {
    await userEvent.click(rowFor(name).ui.getByRole("button", { name: /more actions/i }));
    return within(await screen.findByRole("menu"));
  }

  it("offers Delete on a draft", async () => {
    const menu = (table([form({ employeeName: "Plain Draft", status: "draft" })]),
      await openMenu("Plain Draft"));
    expect(menu.getByRole("menuitem", { name: /^delete$/i })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: /archive/i })).toBeNull();
  });

  it("offers Archive INSTEAD OF Delete on a finalized form", async () => {
    table([form({ employeeName: "Filed One" })]);
    const menu = await openMenu("Filed One");
    expect(menu.getByRole("menuitem", { name: /^archive$/i })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: /^delete$/i })).toBeNull();
  });

  it("offers Restore on an archived row", async () => {
    table([form({ employeeName: "Hidden One", archivedAt: "2026-09-02T00:00:00Z" })], {
      view: "archived",
    });
    const menu = await openMenu("Hidden One");
    expect(menu.getByRole("menuitem", { name: /restore/i })).toBeTruthy();
  });

  it("still names the record before deleting it", async () => {
    table([form({ employeeName: "Plain Draft", status: "draft" })]);
    const menu = await openMenu("Plain Draft");
    await userEvent.click(menu.getByRole("menuitem", { name: /^delete$/i }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Delete this form?")).toBeTruthy();
    expect(dialog.getByText("Plain Draft")).toBeTruthy();
    expect(dialog.getByText("Coaching Form")).toBeTruthy();
    expect(calls.list).toHaveLength(0);

    await userEvent.click(dialog.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]).toMatchObject({ url: "/api/forms/instances/form-1", method: "DELETE" });
  });

  it("still keys the bulk sweep on provenance and states the count", async () => {
    table([form()], { demo: { deletable: 6, protected: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /delete test forms/i }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Delete 6 demo forms?")).toBeTruthy();
    expect(dialog.getByText(/not on the employee/i)).toBeTruthy();
  });
});

/* --------------------------------------------------------------- who may act --- */

describe("who may act", () => {
  it("shows no follow-up controls to somebody without the forms permission", () => {
    mockSession.value = {
      role: "assistant_salon_director",
      user: { name: "QA" },
      can: () => false,
      demoMode: false,
    };
    table([form({ employeeName: "Late One", followUpDate: "2026-09-01" })]);
    const { ui } = rowFor("Late One");
    expect(ui.queryByRole("button", { name: /mark followed up/i })).toBeNull();
    expect((ui.getByLabelText("Follow-up date for Late One") as HTMLInputElement).disabled).toBe(
      true,
    );
    // Reading the record is still allowed.
    expect(ui.getByRole("button", { name: /pdf/i })).toBeTruthy();
  });
});
