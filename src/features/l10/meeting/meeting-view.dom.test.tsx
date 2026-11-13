// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SaveOutcome } from "@/features/l10/data.server";
import type { Roster } from "@/features/l10/lib/config";
import type { LoadedMeeting, MeetingInfo } from "@/features/l10/lib/types";
import type { EndFn } from "./_components/Conclude";
import { MeetingView } from "./MeetingView";
import type { LoadFn, SaveFn } from "./useMeetingSync";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

/*
 * The DM L10 tab renders the Leadership Hub's meeting page (copied as it is) on the Hub's own record. Invented
 * people and data only: the real roster comes from the Hub at request time.
 */
const info: MeetingInfo = { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", cadence: "Tuesdays · 90 min", description: "" };
const roster: Roster = {
  members: [
    { first: "Avery", name: "Avery Quill", role: "Visionary" },
    { first: "Bo", name: "Bo Lark", role: "Integrator" },
    { first: "Cy", name: "Cy Marlow", role: "" },
  ],
  leader: "Bo Lark",
};
const viewer = { id: "hub-user-1", label: "avery.quill@example.test", name: "Avery" };
const loaded = (version = 3, doc: Record<string, unknown> = { attendees: [{ id: "att-avery", name: "Avery Quill", role: "Visionary", shared: true, rating: null }] }): LoadedMeeting => ({ version, updatedAt: null, doc });
const HUB = "https://hub.example.test/meetings/stc-dm";

function renderView(over: { save?: SaveFn; load?: LoadFn; initial?: LoadedMeeting; pollMs?: number } = {}) {
  return render(
    <MeetingView
      info={info}
      initial={over.initial ?? loaded()}
      save={over.save ?? (vi.fn() as unknown as SaveFn)}
      end={vi.fn() as unknown as EndFn}
      load={over.load}
      viewer={viewer}
      roster={roster}
      hubMeetingUrl={HUB}
      pollMs={over.pollMs ?? 0}
      debounceMs={0}
      today="2026-11-13"
      dateLabel="Fri, Nov 13"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the DM L10 page in Ask Sunny", () => {
  it("has the Hub's header: title, team and cadence, leader, Export PDF, History, Start meeting, signed-in name, save status", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("STC DM L10");
    expect(document.body.textContent).toContain("Fri, Nov 13 · STC District Managers · Tuesdays · 90 min · Usually led by Bo Lark");
    expect(screen.getByRole("link", { name: "Export PDF" }).getAttribute("href")).toBe("/meetings/stc-dm/report");
    expect(screen.getByRole("link", { name: "History" }).getAttribute("href")).toBe("/meetings/stc-dm/history");
    expect(screen.getByRole("button", { name: "Start meeting" })).toBeTruthy();
    expect(screen.getByTestId("signed-in-as").textContent).toContain("Avery");
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");
  });

  it("links to the same meeting in the Leadership Hub", () => {
    renderView();
    const link = screen.getByTestId("open-in-hub");
    expect(link.getAttribute("href")).toBe(HUB);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("has the 7-section agenda with times, and the Reference links", () => {
    renderView();
    const agenda = within(screen.getByRole("region", { name: "Agenda" }));
    const items = agenda.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "1 · Segue · Business Best5m",
      "2 · Scorecard5m",
      "3 · Rock Review5m",
      "4 · Customer / Employee Headlines5m",
      "5 · To-Do List5m",
      "6 · IDS · Issues60m",
      "7 · Conclude5m",
    ]);
    expect(agenda.getByRole("button", { name: "Business Plan" })).toBeTruthy();
    expect(agenda.getByRole("button", { name: "Accountability Chart" })).toBeTruthy();
    expect(screen.getByTestId("section-position").textContent).toBe("Section 1 of 7");
  });

  it("the round-robin is the Hub's roster, with seat titles, and the saved check-offs", () => {
    renderView();
    const text = document.body.textContent ?? "";
    for (const person of ["Avery Quill", "Bo Lark", "Cy Marlow", "Visionary", "Integrator"]) expect(text).toContain(person);
    expect(text).toContain("1/3 shared");
  });

  it("checking someone off saves to the Hub on top of the version it was based on", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true, version: 4, updatedAt: "t" }));
    renderView({ save: save as unknown as SaveFn });
    await act(async () => {
      fireEvent.click(screen.getByText("Bo Lark"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(save).toHaveBeenCalledTimes(1);
    const [key, version, doc] = save.mock.calls[0] as unknown as [string, number, { attendees: { name: string; shared: boolean }[] }];
    expect(key).toBe("stc-dm");
    expect(version).toBe(3);
    expect(doc.attendees.find((a) => a.name === "Bo Lark")?.shared).toBe(true);
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");
  });

  it("an edit made in the Hub shows up here on the next refresh (polling the same record)", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ ok: true as const, loaded: loaded(5, { attendees: [{ id: "att-cy", name: "Cy Marlow", role: "", shared: true, rating: null }] }) }));
    renderView({ load: load as unknown as LoadFn, pollMs: 4000 });
    expect(document.body.textContent).toContain("1/3 shared");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(load).toHaveBeenCalledWith("stc-dm");
    // Cy is now checked off (the Hub's edit), Avery no longer (the Hub's document replaced it).
    const cy = screen.getByText("Cy Marlow").closest("button");
    expect(cy?.getAttribute("aria-pressed")).toBe("true");
  });

  it("has the floating Add to IDS button", () => {
    renderView();
    expect(screen.getByRole("button", { name: /Add to IDS/ })).toBeTruthy();
  });

  it("IDS has Short term, Long-term and Recently solved tabs, as in the Hub", () => {
    const issues = [
      { id: "i1", title: "Weekly issue", notes: "", resolved: false },
      { id: "i2", title: "Parked issue", notes: "", resolved: false, term: "long" },
      { id: "i3", title: "Older solved", notes: "", resolved: true, resolvedAt: "2026-11-01T12:00:00.000Z" },
      { id: "i4", title: "Newer solved", notes: "", resolved: true, resolvedAt: "2026-11-10T12:00:00.000Z" },
    ];
    renderView({ initial: loaded(3, { issues }) });
    fireEvent.click(screen.getByRole("button", { name: /6 · IDS · Issues/ }));
    expect(screen.getByRole("tab", { name: "Short term (1)" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("list", { name: "Open issues" })).getByText("Weekly issue")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Long-term (1)" }));
    expect(within(screen.getByRole("list", { name: "Long-term issues" })).getByText("Parked issue")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Recently solved (2)" }));
    const solved = within(screen.getByRole("list", { name: "Solved issues" })).getAllByRole("listitem");
    expect(solved.map((li) => li.textContent)).toEqual([expect.stringContaining("Newer solved"), expect.stringContaining("Older solved")]);
  });

  it("IDS has no ranking: no top-three table, no Rank buttons, no Priority badges (even on issues ranked in the Hub)", () => {
    const issues = [{ id: "i1", title: "Weekly issue", notes: "", resolved: false, votes: { "hub-user-2": { rank: 1, name: "Bo" } } }];
    renderView({ initial: loaded(3, { issues }) });
    fireEvent.click(screen.getByRole("button", { name: /6 · IDS · Issues/ }));
    expect(screen.queryByRole("region", { name: "Everyone's top three" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Rank by you/ })).toBeNull();
    expect(screen.queryByTestId("room-rank")).toBeNull();
    expect(document.body.textContent).not.toContain("Rank your top three");
    expect(within(screen.getByRole("list", { name: "Open issues" })).getByRole("button", { name: "Solve Weekly issue" })).toBeTruthy();
  });
});

describe("saving: the page says saved only when the Hub has saved it", () => {
  it("shows Saving… while the Hub has not answered, and All changes saved only after it confirms", async () => {
    let answer!: (o: SaveOutcome) => void;
    const save = vi.fn(() => new Promise<SaveOutcome>((r) => (answer = r)));
    renderView({ save: save as unknown as SaveFn });
    await act(async () => {
      fireEvent.click(screen.getByText("Bo Lark"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("save-status").textContent).toBe("Saving…");
    await act(async () => {
      answer({ ok: true, version: 4, updatedAt: "t" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");
  });

  it("a failed save says so with the Hub's reason and Try again; Try again saves the same change", async () => {
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, kind: "unavailable", message: "The Leadership Hub could not be reached. Your change is kept on this page." })
      .mockResolvedValueOnce({ ok: true, version: 4, updatedAt: "t" });
    renderView({ save: save as unknown as SaveFn });
    await act(async () => {
      fireEvent.click(screen.getByText("Bo Lark"));
      await new Promise((r) => setTimeout(r, 20));
    });
    const status = screen.getByTestId("save-status");
    expect(status.getAttribute("data-status")).toBe("failed");
    expect(status.textContent).toContain("Not saved: The Leadership Hub could not be reached.");
    expect(status.textContent).not.toContain("All changes saved");
    await act(async () => {
      fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(save).toHaveBeenCalledTimes(2);
    const [, version, doc] = save.mock.calls[1] as unknown as [string, number, { attendees: { name: string; shared: boolean }[] }];
    expect(version).toBe(3);
    expect(doc.attendees.find((a) => a.name === "Bo Lark")?.shared).toBe(true);
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");
  });

  it("a save the Hub refuses as stale is merged with the latest and saved on top of it (never overwrites)", async () => {
    const latest = loaded(7, { attendees: [{ id: "att-avery", name: "Avery Quill", role: "Visionary", shared: true, rating: null }], cascade: "Staffing first" });
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, kind: "stale", latest })
      .mockResolvedValueOnce({ ok: true, version: 8, updatedAt: "t" });
    renderView({ save: save as unknown as SaveFn });
    await act(async () => {
      fireEvent.click(screen.getByText("Bo Lark"));
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const [, version, doc] = save.mock.calls[1] as unknown as [string, number, { cascade?: string; attendees: { name: string; shared: boolean }[] }];
    expect(version).toBe(7);
    expect(doc.cascade).toBe("Staffing first"); // the other person's edit is kept
    expect(doc.attendees.find((a) => a.name === "Bo Lark")?.shared).toBe(true); // and so is this one
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
  });
});
