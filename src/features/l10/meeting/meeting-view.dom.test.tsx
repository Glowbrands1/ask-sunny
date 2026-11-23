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

function renderView(over: { save?: SaveFn; load?: LoadFn; initial?: LoadedMeeting; pollMs?: number; roster?: Roster; mentionPeople?: { id: string; name: string }[] } = {}) {
  return render(
    <MeetingView
      info={info}
      initial={over.initial ?? loaded()}
      save={over.save ?? (vi.fn() as unknown as SaveFn)}
      end={vi.fn() as unknown as EndFn}
      load={over.load}
      viewer={viewer}
      roster={over.roster ?? roster}
      mentionPeople={over.mentionPeople}
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
    // "58 min", not the stored "90 min", since 15 Nov 2026: the cadence line shows the agenda's total (QA).
    expect(document.body.textContent).toContain("Fri, Nov 13 · STC District Managers · Tuesdays · 58 min · Usually led by Bo Lark");
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

  it("has the STC DM agenda with times, and no Reference links", () => {
    renderView();
    const agenda = within(screen.getByRole("region", { name: "Agenda" }));
    const items = agenda.getAllByRole("listitem").map((li) => li.textContent);
    // Changed on purpose 13 Nov 2026: the STC DM L10's leader asked for "AI Best Practice" and no Headlines. Changed
    // again 15 Nov 2026 (the owner's request): its Bloom Growth agenda, titles and minutes exactly (it was "Segue · AI
    // Best Practice" 5 … "IDS · Issues" 65). This roster carries no agenda, so the page uses its copy of the Hub's config.
    expect(items).toEqual([
      "1 · AI Best Practice5m",
      "2 · Scorecard10m",
      "3 · Rock Review8m",
      "4 · To-do List5m",
      "5 · IDS25m",
      "6 · Conclude5m",
    ]);
    // The cadence line shows the agenda's total, so it cannot drift from it (QA, 15 Nov 2026).
    expect(document.body.textContent).toContain("STC District Managers · Tuesdays · 58 min");
    // Changed on purpose 13 Nov 2026: the STC DM L10 has no Reference (its leader asked), so no Business Plan or chart.
    expect(agenda.queryByText("REFERENCE")).toBeNull();
    expect(agenda.queryByRole("button", { name: "Business Plan" })).toBeNull();
    expect(agenda.queryByRole("button", { name: "Accountability Chart" })).toBeNull();
    expect(screen.getByTestId("section-position").textContent).toBe("Section 1 of 6");
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
      fireEvent.click(screen.getByRole("button", { name: /Bo Lark/ })); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
    });
    // The debounced save is waited for, not slept for: a fixed sleep failed under load (QA, 15 Nov 2026).
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
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
    const cy = screen.getByRole("button", { name: /Cy Marlow/ }); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
    expect(cy?.getAttribute("aria-pressed")).toBe("true");
  });

  // Changed on purpose 15 Nov 2026: the STC DM L10's pages are laid out like Bloom Growth's, so the floating Add to IDS
  // button became the New Issue bar (owner, issue, Enter), inline at the top of each page since the owner's report below.
  // Changed on purpose 17 Nov 2026 (port from Ask Bubbles): the New Issue bar became a floating "+ New Issue" button
  // that opens a window, so a page never shows two places to add an issue.
  it("has the New Issue button in place of the floating Add to IDS button", () => {
    renderView();
    expect(screen.queryByRole("button", { name: /^Add to IDS/ })).toBeNull();
    expect(screen.getByRole("button", { name: "+ New Issue" }).hasAttribute("data-page-fab")).toBe(true);
    expect(screen.queryByRole("form", { name: "New Issue" })).toBeNull();
  });

  it("IDS has Short term, Long-term and Recently solved tabs, as in the Hub", () => {
    const issues = [
      { id: "i1", title: "Weekly issue", notes: "", resolved: false },
      { id: "i2", title: "Parked issue", notes: "", resolved: false, term: "long" },
      { id: "i3", title: "Older solved", notes: "", resolved: true, resolvedAt: "2026-11-01T12:00:00.000Z" },
      { id: "i4", title: "Newer solved", notes: "", resolved: true, resolvedAt: "2026-11-10T12:00:00.000Z" },
    ];
    renderView({ initial: loaded(3, { issues }) });
    fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));
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
    // Any position: the STC DM agenda has no Headlines since 13 Nov 2026, so IDS is item 5 there (6 elsewhere).
    fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));
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
      fireEvent.click(screen.getByRole("button", { name: /Bo Lark/ })); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
    });
    // The debounced save is waited for, not slept for: a fixed sleep failed under load (QA, 15 Nov 2026).
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
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
      fireEvent.click(screen.getByRole("button", { name: /Bo Lark/ })); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
    });
    // The debounced save is waited for, not slept for: a fixed sleep failed under load (QA, 15 Nov 2026).
    await waitFor(() => expect(screen.getByTestId("save-status").getAttribute("data-status")).toBe("failed"));
    const status = screen.getByTestId("save-status");
    expect(status.textContent).toContain("Not saved: The Leadership Hub could not be reached.");
    expect(status.textContent).not.toContain("All changes saved");
    await act(async () => {
      fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
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
      fireEvent.click(screen.getByRole("button", { name: /Bo Lark/ })); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
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

describe("the agenda, hints and roster come from the Hub (the STC DM L10 change, 13 Nov 2026)", () => {
  const hubAgenda = [
    { key: "business-best", title: "Segue · AI Best Practice", minutes: 5 },
    { key: "scorecard", title: "Scorecard", minutes: 5 },
    { key: "rocks", title: "Rock Review", minutes: 5 },
    { key: "todos", title: "To-Do List", minutes: 5 },
    { key: "ids", title: "IDS · Issues", minutes: 65 },
    { key: "conclude", title: "Conclude", minutes: 5 },
  ] as Roster["agenda"];

  it("runs the agenda and hints the Hub sends (a change in the Hub reaches this page with no Ask Sunny deploy)", () => {
    // A title only the Hub knows proves the page uses the Hub's agenda, not its own copy.
    renderView({ roster: { ...roster, agenda: hubAgenda!.map((a) => (a.key === "scorecard" ? { ...a, title: "Scorecard (from the Hub)" } : a)), hints: { "business-best": "Hint from the Hub." } } });
    const items = within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["1 · Segue · AI Best Practice5m", "2 · Scorecard (from the Hub)5m", "3 · Rock Review5m", "4 · To-Do List5m", "5 · IDS · Issues65m", "6 · Conclude5m"]);
    expect(document.body.textContent).toContain("Hint from the Hub.");
    expect(document.body.textContent).not.toContain("Headlines");
  });

  it("falls back to its copy of the Hub's config when the Hub's agenda is malformed", () => {
    renderView({ roster: { ...roster, agenda: [{ key: "nope", title: 3, minutes: -1 }] as unknown as Roster["agenda"] } });
    expect(within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("listitem")).toHaveLength(6);
    expect(document.body.textContent).toContain("Round-robin: each person shares one AI best practice, then you check them off.");
  });

  it("someone the Hub no longer lists is hidden, never deleted: a check-off saves their row untouched", async () => {
    const hidden = { id: "att-dex", name: "Dex Rowan", role: "", shared: true, rating: 9 };
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true, version: 4, updatedAt: "t" }));
    renderView({ save: save as unknown as SaveFn, roster: { ...roster, agenda: hubAgenda }, initial: loaded(3, { attendees: [{ id: "att-avery", name: "Avery Quill", role: "Visionary", shared: true, rating: null }, hidden] }) });
    expect(document.body.textContent).not.toContain("Dex Rowan");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Bo Lark/ })); // by role: the New Issue bar's owner picker lists the names too (15 Nov 2026)
    });
    // The debounced save is waited for, not slept for: a fixed sleep failed under load (QA, 15 Nov 2026).
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, , doc] = save.mock.calls[0] as unknown as [string, number, { attendees: { name: string }[] }];
    expect(doc.attendees.map((a) => a.name)).toEqual(["Avery Quill", "Bo Lark", "Cy Marlow", "Dex Rowan"]);
    expect(doc.attendees.find((a) => a.name === "Dex Rowan")).toEqual(hidden);
  });

  it("an issue someone adds saves their full name, so their initials show on it", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-14T00:00:00Z" } satisfies SaveOutcome);
    renderView({ save: save as unknown as SaveFn, initial: loaded(3, { issues: [] }), mentionPeople: [{ id: "hub-user-1", name: "Avery Quill" }] });
    fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ })); // "IDS" in the STC DM L10's Bloom agenda since 15 Nov 2026
    fireEvent.change(screen.getByLabelText("Identify a new issue"), { target: { value: "New onboarding process" } });
    fireEvent.click(screen.getByRole("button", { name: "Add issue" }));
    // Changed on purpose 15 Nov 2026: on the Bloom-style page the IDS quick-add has an owner picker, which starts on the
    // person adding, so the row shows the owner's initials (here the same person) instead of "Added by".
    expect(within(screen.getByRole("list", { name: "Open issues" })).getByTitle("Avery Quill").textContent).toBe("AQOwner: Avery Quill");
    await act(async () => {
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
    });
    const doc = save.mock.calls.at(-1)![2] as { issues: { title: string; addedBy?: string }[] };
    expect(doc.issues.at(-1)).toMatchObject({ title: "New onboarding process", addedBy: "Avery Quill" });
  });
});

describe("no Reference for the STC DM L10 (its leader's request, 13 Nov 2026)", () => {
  it("a link to a reference view opens the agenda; a leader on the Business Plan is not followed there", () => {
    render(
      <MeetingView info={info} initial={loaded(3, { timer: { started: true, running: true, startedAt: 1, leader: "someone-else", leaderLabel: "x", leaderView: "business-plan", sessionId: "s1" } })} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={{ ...roster, reference: false }} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-13" dateLabel="Fri, Nov 13" initialView="business-plan" />,
    );
    expect(screen.queryByRole("heading", { name: "Business Plan" })).toBeNull();
    expect(document.body.textContent).not.toContain("Vision, core values");
    expect(screen.getByRole("heading", { level: 2, name: /AI Best Practice/ })).toBeTruthy(); // the first section, titled "AI Best Practice" (no "Segue ·") since its Bloom agenda, 15 Nov 2026
  });

  it("the Hub's word that a meeting has no Reference is followed", async () => {
    const { referenceFromRoster } = await import("@/features/l10/lib/config");
    expect(referenceFromRoster("stc-dm", {})).toBe(false);
    expect(referenceFromRoster("bcs-dm", { reference: false })).toBe(false);
    expect(referenceFromRoster("bcs-dm", {})).toBe(true);
    // A Hub that says "true" cannot bring it back for the STC DM L10.
    expect(referenceFromRoster("stc-dm", { reference: true })).toBe(false);
  });

  it("its report has no Business Plan or org chart pages", async () => {
    const { reportSections } = await import("@/features/l10/lib/report");
    expect(reportSections("stc-dm").map((s) => s.title)).toEqual(["Goals", "Issues", "Metrics", "Meeting Recaps"]);
    expect(reportSections("bcs-dm").map((s) => s.title)).toContain("Business Plan");
  });
});

describe("IDS: move between the lists from the row, and no headlines where the meeting has none (15 Nov 2026)", () => {
  const issues = [
    { id: "a1", title: "Weekly issue", notes: "", resolved: false },
    { id: "a2", title: "Parked issue", notes: "", resolved: false, term: "long" },
    { id: "a3", title: "Done issue", notes: "", resolved: true, resolvedAt: "2026-11-10T12:00:00.000Z" },
  ];
  const openIds = () => fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));

  it("each open row has Long-term / Short term next to Solve; it moves the issue and the tab counts follow", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true, version: 4, updatedAt: "t" }));
    renderView({ save: save as unknown as SaveFn, initial: loaded(3, { issues }) });
    openIds();
    const shortRow = within(screen.getByRole("list", { name: "Open issues" })).getByRole("listitem");
    const buttons = within(shortRow).getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Long-term")).toBe(buttons.indexOf("Solve") + 1);
    expect(buttons.indexOf("Delete")).toBeGreaterThan(buttons.indexOf("Long-term"));
    await act(async () => {
      fireEvent.click(within(shortRow).getByRole("button", { name: "Move to long-term: Weekly issue" }));
    });
    // The debounced save is waited for, not slept for: a fixed sleep failed under load (QA, 15 Nov 2026).
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Short term (0)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Long-term (2)" })).toBeTruthy();
    const [, , doc] = save.mock.calls.at(-1) as unknown as [string, number, { issues: { id: string; term?: string }[] }];
    expect(doc.issues.find((i) => i.id === "a1")?.term).toBe("long");
    fireEvent.click(screen.getByRole("tab", { name: "Long-term (2)" }));
    fireEvent.click(within(screen.getByRole("list", { name: "Long-term issues" })).getByRole("button", { name: "Move to short term: Parked issue" }));
    expect(screen.getByRole("tab", { name: "Short term (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Long-term (1)" })).toBeTruthy();
  });

  it("solved rows have no move button", () => {
    renderView({ initial: loaded(3, { issues }) });
    openIds();
    fireEvent.click(screen.getByRole("tab", { name: "Recently solved (1)" }));
    const solved = within(screen.getByRole("list", { name: "Solved issues" })).getByRole("listitem");
    expect(within(solved).queryByRole("button", { name: /^Move to/ })).toBeNull();
  });

  it("Convert to Headline shows only where the meeting's agenda has Headlines (the STC DM L10 does not)", () => {
    renderView({ initial: loaded(3, { issues: [issues[0]] }) });
    openIds();
    fireEvent.click(screen.getByRole("button", { name: /Weekly issue/, expanded: false }));
    const detail = within(screen.getByRole("region", { name: "Issue detail" }));
    expect(detail.queryByRole("button", { name: "Headline" })).toBeNull();
    expect(detail.getByRole("button", { name: "To-Do" })).toBeTruthy();
    expect(detail.getByRole("button", { name: "Rock" })).toBeTruthy();
    cleanup();
    // A meeting whose Hub-served agenda has Headlines (as BCS DM's does) keeps the button.
    const withHeadlines = [
      { key: "business-best", title: "Segue · Business Best", minutes: 5 },
      { key: "headlines", title: "Customer / Employee Headlines", minutes: 5 },
      { key: "ids", title: "IDS · Issues", minutes: 60 },
      { key: "conclude", title: "Conclude", minutes: 5 },
    ] as Roster["agenda"];
    renderView({ initial: loaded(3, { issues: [issues[0]] }), roster: { ...roster, agenda: withHeadlines } });
    openIds();
    fireEvent.click(screen.getByRole("button", { name: /Weekly issue/, expanded: false }));
    expect(within(screen.getByRole("region", { name: "Issue detail" })).getByRole("button", { name: "Headline" })).toBeTruthy();
  });
});

// The STC DM L10's pages are laid out like Bloom Growth's (the owner's request, 15 Nov 2026): Meeting Notes under the
// agenda, "Last meeting's summary" on top and the New Issue bar (inline at the top of each page), as in the Hub.
describe("Bloom-style page: what every page shares", () => {
  const recap = {
    id: "r1",
    meeting_key: "stc-dm",
    session_id: "s1",
    held_at: "2026-11-10T16:00:00Z",
    rating_avg: 8.5,
    attendee_count: 2,
    duration_seconds: 3480,
    cascade: "Share the new schedule",
    attendees: [
      { name: "Avery Quill", rating: 9 },
      { name: "Bo Lark", rating: 8 },
    ],
    open_todos: [],
    resolved_issues: ["Front desk coverage"],
  };

  // Replaces the 15 Nov test of the inline bar: the To-do and IDS pages showed it next to their own add row.
  it('"in ask sunny DM L10 there 2 of these, just need 1" (the owner, 17 Nov 2026)', () => {
    renderView();
    const agenda = within(screen.getByRole("region", { name: "Agenda" }));
    for (const section of [/Scorecard/, /Rock Review/, /To-do List/, /· IDS/, /Conclude/]) {
      fireEvent.click(agenda.getAllByRole("button", { name: section })[0]);
      // No banner on the page, only the floating button.
      expect(screen.queryByRole("form", { name: "New Issue" }), `${section}`).toBeNull();
      expect(screen.getByRole("button", { name: "+ New Issue" }).className).toMatch(/\bfixed\b/);
    }
    // To-do List: one add row (the to-do's own); IDS: one issue field (its own).
    fireEvent.click(agenda.getAllByRole("button", { name: /To-do List/ })[0]);
    expect(screen.queryAllByPlaceholderText(/New Issue/)).toHaveLength(0);
    fireEvent.click(agenda.getAllByRole("button", { name: /· IDS/ })[0]);
    expect(screen.getAllByRole("textbox", { name: /issue/i }).map((t) => t.getAttribute("aria-label"))).toEqual(["Identify a new issue"]);
    // The button, and the "i" shortcut, open the New Issue window.
    fireEvent.click(screen.getByRole("button", { name: "+ New Issue" }));
    expect(screen.getByRole("dialog", { name: "New Issue" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "New Issue" })).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "i" });
    expect(screen.getByRole("dialog", { name: "New Issue" })).toBeTruthy();
  });

  it("Meeting Notes opens the shared notes pad in a side panel, saves as meetingNotes, and Esc closes it", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-15T00:00:00Z" } satisfies SaveOutcome);
    renderView({ save: save as unknown as SaveFn, initial: loaded(3, { meetingNotes: "Earlier note" }) });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Meeting Notes/ }));
    // Not inside the agenda card: a fixed panel there was pinned to the card and showed on the left, half off-screen
    // (the owner's report, 15 Nov 2026). It is portalled out, with its title next to the close button.
    const panel = screen.getByRole("dialog", { name: "Meeting Notes" });
    expect(screen.getByRole("region", { name: "Agenda" }).contains(panel)).toBe(false);
    expect(within(panel).getByRole("heading", { name: "Meeting Notes" })).toBeTruthy();
    const field = within(panel).getByLabelText("Meeting notes") as HTMLTextAreaElement;
    expect(field.value).toBe("Earlier note");
    fireEvent.change(field, { target: { value: "Earlier note and more" } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls.at(-1)![2] as { meetingNotes: string }).meetingNotes).toBe("Earlier note and more");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Meeting Notes" })).toBeNull();
  });

  it("Meeting Notes is portalled into the DM L10 frame (.hub-l10), so it keeps the tab's scoped styles", () => {
    render(
      <div className="hub-l10" data-testid="frame">
        <MeetingView info={info} initial={loaded()} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-15" />
      </div>,
    );
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Meeting Notes/ }));
    const panel = screen.getByRole("dialog", { name: "Meeting Notes" });
    expect(panel.parentElement).toBe(screen.getByTestId("frame"));
    expect(screen.getByRole("region", { name: "Agenda" }).contains(panel)).toBe(false);
  });

  it("Last meeting's summary is collapsed by default and opens on the latest recap", () => {
    render(
      <MeetingView info={info} initial={loaded()} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-15" recaps={[recap]} />,
    );
    const toggle = within(screen.getByRole("region", { name: "Last meeting's summary" })).getByRole("button", { name: /Last meeting's summary/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("last-meeting-summary")).toBeNull();
    fireEvent.click(toggle);
    const body = within(screen.getByTestId("last-meeting-summary"));
    expect(body.getByText("Meeting rating").nextSibling?.textContent).toBe("8.5");
    expect(body.getByText("Total time").nextSibling?.textContent).toBe("58m");
    expect(body.getByText("Front desk coverage")).toBeTruthy();
  });

  it("Last meeting's summary renders solved issues stored as { title, owner } as well as plain titles", () => {
    render(
      <MeetingView info={info} initial={loaded()} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-15" recaps={[{ ...recap, resolved_issues: [{ title: "Door lock", owner: "Bo Lark" }, "Old style title"] }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Last meeting's summary/ }));
    const body = within(screen.getByTestId("last-meeting-summary"));
    expect(body.getByText("Door lock")).toBeTruthy();
    expect(body.getByText("Old style title")).toBeTruthy();
    expect(body.getByText("Issues solved").nextSibling?.textContent).toBe("2");
  });

  it("the New Issue button saves the issue with its owner and who added it", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-15T00:00:00Z" } satisfies SaveOutcome);
    renderView({ save: save as unknown as SaveFn, initial: loaded(3, { issues: [] }), mentionPeople: [{ id: "hub-user-1", name: "Avery Quill" }] });
    fireEvent.click(screen.getByRole("button", { name: "+ New Issue" }));
    const bar = within(screen.getByRole("form", { name: "New Issue" }));
    fireEvent.change(bar.getByLabelText("Issue owner"), { target: { value: "Cy Marlow" } });
    fireEvent.change(bar.getByRole("textbox", { name: "New Issue" }), { target: { value: "Late shift handover" } });
    fireEvent.submit(screen.getByRole("form", { name: "New Issue" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const doc = save.mock.calls.at(-1)![2] as { issues: Record<string, unknown>[] };
    expect(doc.issues.at(-1)).toMatchObject({ title: "Late shift handover", owner: "Cy Marlow", addedBy: "Avery Quill", resolved: false });
  });
});

// Segue and Conclude on the Bloom-style STC DM L10 (the owner's request, 15 Nov 2026), as in the Hub.
describe("Bloom-style page: Segue and Conclude", () => {
  const recap = {
    id: "r1",
    meeting_key: "stc-dm",
    session_id: "s1",
    held_at: "2026-11-10T16:00:00Z",
    rating_avg: 8.5,
    attendee_count: 2,
    duration_seconds: 3480,
    cascade: "Share the new schedule",
    attendees: [
      { name: "Avery Quill", rating: 9 },
      { name: "Bo Lark", rating: 8 },
    ],
    open_todos: [{ text: "Order towels", owner: "Avery Quill", dueDate: "2026-11-20" }],
    resolved_issues: [{ title: "Front desk coverage", owner: "Bo Lark" }],
    notes: "Talked about the holiday hours",
    todos_done: 3,
    todos_total: 4,
  };
  const view = (doc: Record<string, unknown> = {}, save: SaveFn = vi.fn() as unknown as SaveFn) =>
    render(<MeetingView info={info} initial={loaded(3, doc)} save={save} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-15" recaps={[recap]} />);

  it("Segue: last week's feedback, then this week's icebreaker question saved as segueQuestion", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-15T00:00:00Z" } satisfies SaveOutcome);
    view({ segueQuestion: "What AI tool saved you time?" }, save as unknown as SaveFn);
    const feedback = screen.getByRole("region", { name: "Last week's feedback" });
    expect(within(feedback).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["9Avery Quill", "8Bo Lark"]);
    const q = within(screen.getByRole("region", { name: "This week's icebreaker question" })).getByLabelText("This week's icebreaker question") as HTMLTextAreaElement;
    expect(q.value).toBe("What AI tool saved you time?");
    fireEvent.change(q, { target: { value: "What AI tool saved you an hour?" } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls.at(-1)![2] as { segueQuestion: string }).segueQuestion).toBe("What AI tool saved you an hour?");
  });

  it("the icebreaker question shows the save status under it, so typing visibly saves (the owner thought it did not, 15 Nov 2026)", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-15T00:00:00Z" } satisfies SaveOutcome);
    view({}, save as unknown as SaveFn);
    const box = within(screen.getByRole("region", { name: "This week's icebreaker question" }));
    expect(box.getByRole("heading", { name: "THIS WEEK'S ICEBREAKER QUESTION" })).toBeTruthy();
    const field = box.getByLabelText("This week's icebreaker question") as HTMLTextAreaElement;
    expect(field.getAttribute("placeholder")).toBe("Add this week's icebreaker question…");
    fireEvent.change(field, { target: { value: "Best tool this week?" } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() => expect(box.getByTestId("segue-save-status").textContent).toBe("All changes saved"));
  });

  it("Conclude before the meeting starts shows the last meeting's summary; during the meeting the existing steps", () => {
    const { unmount } = view();
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Conclude/ }));
    const summary = within(screen.getByTestId("last-meeting-conclusion"));
    expect(summary.getAllByRole("definition").map((d) => d.textContent)).toEqual(["8.5", "75%", "1", "58m"]);
    expect(summary.getByRole("group", { name: "Issues solved by owner" }).textContent).toBe("BLBo LarkFront desk coverage");
    expect(summary.getByRole("group", { name: "To-dos by owner" }).textContent).toBe("AQAvery QuillOrder towels11-20-2026");
    expect(summary.getByText("Talked about the holiday hours")).toBeTruthy();
    unmount();
    view({ timer: { started: true, running: true, startedAt: Date.now(), leader: "hub-user-1", leaderLabel: "x", sessionId: "s2" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Conclude/ }));
    expect(screen.queryByTestId("last-meeting-conclusion")).toBeNull();
    expect(screen.getByLabelText("Cascading message")).toBeTruthy();
  });
});

// QA, 15 Nov 2026: Rock Review edits a rock in a panel on the right (a goal drawer), as in the Hub, not inline.
describe("Rock Review: a rock opens in a side panel", () => {
  const rocks = [
    { id: "k1", title: "Open two new rooms", owner: "Avery Quill", status: "on-track", milestones: [{ id: "m1", text: "Sign the lease", done: false }] },
    { id: "k2", title: "Hire a trainer", owner: "Cy Marlow", status: "on-track", milestones: [] },
  ];
  const start = () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-13T00:00:00Z" } satisfies SaveOutcome);
    const { container } = renderView({ save: save as unknown as SaveFn, initial: loaded(3, { attendees: [], rocks }) });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Rock Review/ }));
    return { save, container };
  };
  const panel = () => screen.getByRole("dialog", { name: "Edit rock" });
  const row = (title: string) => screen.getByRole("button", { name: `Edit ${title}` });

  it("clicking a rock opens the panel with its fields, and the list stays", () => {
    const { container } = start();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(row("Open two new rooms"));
    const p = within(panel());
    expect((p.getByLabelText("Rock title") as HTMLInputElement).value).toBe("Open two new rooms");
    expect((p.getByLabelText("Owner of Open two new rooms") as HTMLSelectElement).value).toBe("Avery Quill");
    expect(p.getByLabelText("Due date of Open two new rooms")).toBeTruthy();
    expect((p.getByLabelText("Status of Open two new rooms") as HTMLSelectElement).value).toBe("on-track");
    expect(p.getByRole("checkbox", { name: "Milestone done: Sign the lease" })).toBeTruthy();
    expect(p.getByLabelText("Add milestone")).toBeTruthy();
    expect(p.getByLabelText("Notes for Open two new rooms")).toBeTruthy();
    expect(row("Hire a trainer").getAttribute("aria-expanded")).toBe("false");
    // Rendered in place, not portalled out, so in the app it sits inside the DM L10 frame's styles (.hub-l10), where
    // the floating buttons move clear of it (globals.css, [data-side-panel]).
    expect(container.contains(panel())).toBe(true);
    expect(panel().hasAttribute("data-side-panel")).toBe(true);
  });

  it("ticking a milestone saves through the same path", async () => {
    const { save } = start();
    fireEvent.click(row("Open two new rooms"));
    fireEvent.click(within(panel()).getByRole("checkbox", { name: "Milestone done: Sign the lease" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const doc = save.mock.calls.at(-1)![2] as { rocks: { id: string; milestones: { done: boolean }[] }[] };
    expect(doc.rocks.find((r) => r.id === "k1")!.milestones[0].done).toBe(true);
    // It autosaves (no Save button); the footer repeats the meeting's save status quietly, as in Bloom's goal drawer.
    expect(within(panel()).queryByRole("button", { name: /^Save/ })).toBeNull();
    await waitFor(() => expect(within(panel()).getByTestId("rock-panel-save-status").textContent).toBe("All changes saved"));
  });

  it("closes with the close button and with Esc", () => {
    start();
    fireEvent.click(row("Open two new rooms"));
    fireEvent.click(screen.getByRole("button", { name: "Close rock editor" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(row("Open two new rooms"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only one rock is open at a time", () => {
    start();
    fireEvent.click(row("Open two new rooms"));
    fireEvent.click(row("Hire a trainer"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect((within(panel()).getByLabelText("Rock title") as HTMLInputElement).value).toBe("Hire a trainer");
  });
});

// The scorecard on the Bloom-style STC DM L10 (the owner's request, 15 Nov 2026), as in the Hub.
describe("Bloom-style page: Scorecard", () => {
  it("has Who, Metric, Goal and the weeks newest first by range, this week shaded, rows by owner, cells tinted", () => {
    const row = (id: string, metric: string, owner: string, weeks: (number | null)[]) => ({ id, metric, owner, goal: "≥ 5", goalValue: 5, higherIsBetter: true, format: "number", weeks });
    render(
      <MeetingView
        info={info}
        initial={loaded(3, { weekEndings: ["11/01/2026", "11/08/2026", "11/15/2026"], scorecard: [row("s1", "Sales calls", "Avery Quill", [4, 6, null]), row("s2", "Reviews", "Bo Lark", [7, 2, 5]), row("s3", "Visits", "Avery Quill", [5, 5, 9])] })}
        save={vi.fn() as unknown as SaveFn}
        end={vi.fn() as unknown as EndFn}
        viewer={viewer}
        roster={roster}
        hubMeetingUrl={HUB}
        pollMs={0}
        debounceMs={0}
        today="2026-11-12"
      />,
    );
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Scorecard/ }));
    const table = within(screen.getByTestId("bloom-scorecard"));
    const heads = table.getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent)).toEqual(["Who", "Metric", "Goal", "9 Nov / 15 Nov", "2 Nov / 8 Nov", "26 Oct / 1 Nov"]);
    expect(heads.filter((h) => h.dataset.current).map((h) => h.textContent)).toEqual(["9 Nov / 15 Nov"]);
    expect(table.getAllByRole("rowgroup").slice(1).map((g) => g.getAttribute("aria-label"))).toEqual(["Avery Quill's metrics", "Bo Lark's metrics"]);
    expect(table.getByRole("button", { name: "Sales calls 9 Nov / 15 Nov: —" }).className).toContain("border-dashed");
    expect(table.getByRole("button", { name: "Sales calls 2 Nov / 8 Nov: 6" }).className).toContain("bg-[#e1f1e4]");
    expect(table.getByRole("button", { name: "Sales calls 26 Oct / 1 Nov: 4" }).className).toContain("bg-[#fbe4e4]");
  });
});

// Rocks and To-dos on the Bloom-style STC DM L10 (the owner's request, 15 Nov 2026), as in the Hub.
describe("Bloom-style page: Rocks and To-dos", () => {
  const doc = {
    rocks: [
      {
        id: "k1",
        title: "Open two rooms",
        owner: "Avery Quill",
        status: "on-track",
        milestones: [
          { id: "m1", text: "Sign the lease", done: true },
          { id: "m2", text: "Hire staff", done: false, dueDate: "2026-11-01" },
          { id: "m3", text: "Open", done: false, dueDate: "2026-12-20" },
        ],
      },
    ],
    todos: [
      { id: "t1", text: "Order towels", owner: "Avery Quill", done: false, due: "Next wk", dueDate: "2026-11-20" },
      { id: "t2", text: "Call the landlord", owner: "Bo Lark", done: true, due: "Next wk" },
    ],
  };
  const view = () =>
    render(<MeetingView info={info} initial={loaded(3, doc)} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-15" />);

  it("Rocks: All rocks tab, owner header with initials, milestone bar, chevron, Expand milestones and Owner: A–Z", () => {
    view();
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Rock Review/ }));
    expect(screen.getByRole("tab", { name: "All rocks (1)" })).toBeTruthy();
    const avery = within(screen.getByRole("region", { name: "Avery Quill's Rocks" }));
    expect(avery.getByTitle("Avery Quill").textContent).toBe("AQ");
    const bar = avery.getByRole("img", { name: "Milestones: 1 done, 1 overdue, 1 to do" });
    expect([...bar.children].map((c) => (c as HTMLElement).dataset.state)).toEqual(["done", "overdue", "open"]);
    fireEvent.click(avery.getByRole("button", { name: "Show milestones of Open two rooms" }));
    expect(within(screen.getByRole("list", { name: "Milestones of Open two rooms" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["✓Sign the lease", "Hire staff11-01-2026", "Open12-20-2026"]);
    expect(screen.getByRole("button", { name: "Expand milestones" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Owner: A–Z" })).toBeTruthy();
  });

  it("To-dos: % Completed, round checks, initials and MM-DD-YYYY due dates", () => {
    view();
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /To-do List/ }));
    expect(screen.getByTestId("todos-completed").textContent).toBe("50% Completed");
    const rows = within(screen.getByRole("list", { name: "To-dos" })).getAllByRole("listitem");
    const row = within(rows.find((r) => r.textContent?.includes("Order towels"))!);
    expect(row.getByRole("checkbox", { name: "Done: Order towels" }).getAttribute("aria-checked")).toBe("false");
    expect(row.getByTitle("Avery Quill").textContent).toBe("AQAvery Quill");
    expect(row.getByTestId("todo-due").textContent).toBe("11-20-2026");
    expect(within(rows.find((r) => r.textContent?.includes("Call the landlord"))!).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  });
});

// IDS on the Bloom-style STC DM L10 (the owner's request, 15 Nov 2026), as in the Hub.
describe("Bloom-style page: IDS", () => {
  it('"in ask sunny, we should be able to label 1 2 3 and appear that they are indeed 1 2 3 in ranking" (the owner, 17 Nov 2026)', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-17T00:00:00Z" } satisfies SaveOutcome);
    renderView({
      save: save as unknown as SaveFn,
      initial: loaded(3, { issues: ["Alpha", "Bravo", "Charlie", "Delta"].map((t, n) => ({ id: `i${n + 1}`, title: t, notes: "", resolved: false })) }),
    });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("button", { name: /· IDS/ })[0]);
    const shown = () =>
      within(screen.getByRole("list", { name: "Open issues" }))
        .getAllByRole("listitem")
        .map((li) => `${li.querySelector("[data-testid=priority-number]")?.textContent ?? ""}${li.querySelector("[aria-expanded] .font-semibold")?.textContent}`);
    fireEvent.click(screen.getByRole("button", { name: "Priority: Charlie" }));
    fireEvent.click(screen.getByRole("button", { name: "Priority: Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Priority: Delta" }));
    expect(shown()).toEqual(["1Charlie", "2Alpha", "3Delta", "Bravo"]);
    fireEvent.click(screen.getByRole("button", { name: "Priority 1: Charlie" }));
    expect(shown()).toEqual(["1Alpha", "2Delta", "Bravo", "Charlie"]);
    await waitFor(() => expect(save).toHaveBeenCalled());
    const issues = (save.mock.calls.at(-1)![2] as { issues: { title: string; priority?: boolean; priorityOrder?: number }[] }).issues;
    expect(issues.filter((i) => i.priority).sort((a, b) => a.priorityOrder! - b.priorityOrder!).map((i) => i.title)).toEqual(["Alpha", "Delta"]);
  });

  it("rows have a ! circle, the owner's initials, Solve and the term button; ! issues first; Oldest / Newest", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-15T00:00:00Z" } satisfies SaveOutcome);
    renderView({
      save: save as unknown as SaveFn,
      initial: loaded(3, {
        issues: [
          { id: "i1", title: "First issue", notes: "", resolved: false, owner: "Bo Lark" },
          { id: "i2", title: "Second issue", notes: "", resolved: false },
          { id: "i3", title: "Third issue", notes: "", resolved: false, priority: true, owner: "Cy Marlow" },
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));
    const titles = () => within(screen.getByRole("list", { name: "Open issues" })).getAllByRole("listitem").map((li) => li.querySelector("[aria-expanded] .font-semibold")?.textContent);
    expect(titles()).toEqual(["Third issue", "First issue", "Second issue"]);
    const first = within(within(screen.getByRole("list", { name: "Open issues" })).getAllByRole("listitem")[1]);
    expect(first.getByRole("button", { name: "Priority: First issue" }).getAttribute("aria-pressed")).toBe("false");
    expect(first.getByTitle("Bo Lark").textContent).toBe("BLOwner: Bo Lark");
    expect(first.getByRole("button", { name: "Solve First issue" })).toBeTruthy();
    expect(first.getByRole("button", { name: "Move to long-term: First issue" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Sort issues"), { target: { value: "newest" } });
    expect(titles()).toEqual(["Third issue", "Second issue", "First issue"]);
    fireEvent.click(screen.getByRole("button", { name: "Priority: Second issue" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect((save.mock.calls.at(-1)![2] as { issues: { id: string; priority?: boolean }[] }).issues.find((i) => i.id === "i2")?.priority).toBe(true);
  });
});

// "Can we add myself, and any other DM or higher role as a drop down option to add to-do's and issues?" (17 Nov 2026).
describe("owner menus list the DM-or-higher people from Woven", () => {
  it("to-dos, the New Issue window and IDS offer the meeting's people first, then the others", () => {
    render(
      <MeetingView info={info} initial={loaded(3, { todos: [], issues: [] })} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-17" ownerPeople={["Avery Quill", "Dee Wren", "Eli Sorrel"]} />,
    );
    const options = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => o.textContent);
    const expected = [...roster.members.map((m) => m.name), "Dee Wren", "Eli Sorrel"];
    const agenda = within(screen.getByRole("region", { name: "Agenda" }));
    fireEvent.click(agenda.getAllByRole("button", { name: /To-do List/ })[0]);
    expect(options(screen.getByLabelText("To-do owner"))).toEqual(expected);
    fireEvent.click(screen.getByRole("button", { name: "+ New Issue" }));
    expect(options(within(screen.getByRole("dialog", { name: "New Issue" })).getByLabelText("Issue owner"))).toEqual(expected);
    fireEvent.click(within(screen.getByRole("dialog", { name: "New Issue" })).getByRole("button", { name: "Cancel" }));
    fireEvent.click(agenda.getAllByRole("button", { name: /· IDS/ })[0]);
    expect(options(screen.getByLabelText("Issue owner"))).toEqual(expected);
  });
});

describe("rocks owner menus list the DM-or-higher people from Woven too", () => {
  it('"add all of them in rocks drop down too pls" (the owner, 18 Nov 2026): the add form and the rock panel offer them; no empty sections for them', () => {
    render(
      <MeetingView info={info} initial={loaded(3, { rocks: [{ id: "k1", title: "Open two rooms", owner: "Avery Quill", status: "on-track", milestones: [] }] })} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-18" ownerPeople={["Avery Quill", "Dee Wren", "Eli Sorrel"]} />,
    );
    const options = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => o.textContent);
    const expected = ["Company", ...roster.members.map((m) => m.name), "Dee Wren", "Eli Sorrel"];
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("button", { name: /Rock Review/ })[0]);
    expect(options(screen.getByLabelText("New rock owner"))).toEqual(expected);
    // The extra people get no "No rocks for …" section.
    expect(screen.queryByRole("region", { name: /Dee Wren/ })).toBeNull();
    expect(document.body.textContent).not.toContain("No rocks for Dee Wren");
    fireEvent.click(screen.getByRole("button", { name: "Edit Open two rooms" }));
    expect(options(screen.getByLabelText("Owner of Open two rooms"))).toEqual(expected);
    // A rock added for one of them shows under their name.
    fireEvent.click(screen.getByRole("button", { name: "Close rock editor" }));
    fireEvent.change(screen.getByLabelText("New rock title"), { target: { value: "Coach the new leads" } });
    fireEvent.change(screen.getByLabelText("New rock owner"), { target: { value: "Dee Wren" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rock" }));
    expect(screen.getAllByRole("region", { name: /Dee Wren/ }).length).toBeGreaterThan(0);
  });
});

describe("Scorecard Full width (port from Ask Bubbles)", () => {
  it("Full width hides the agenda column on the Scorecard page only; Collapse brings it back", () => {
    window.localStorage.clear();
    renderView();
    const agendaButton = (n: RegExp) => within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("button", { name: n })[0];
    fireEvent.click(agendaButton(/Scorecard/));
    fireEvent.click(screen.getByRole("button", { name: "⤢ Full width" }));
    expect(screen.queryByRole("region", { name: "Agenda" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "⤡ Collapse" }));
    expect(screen.getByRole("region", { name: "Agenda" })).toBeTruthy();
    window.localStorage.clear();
  });
});

// The DM L10 run-through (17 Nov 2026), in its words: "Conclude: Make sure every meeting attendee can submit their own
// meeting rating."
describe("Conclude: every meeting attendee can submit their own meeting rating", () => {
  const timer = { started: true, running: true, startedAt: Date.now(), leader: "hub-user-2", leaderLabel: "Bo", sessionId: "s9" };
  const attendees = [
    { id: "att-avery", name: "Avery Quill", role: "Visionary", shared: true, rating: null },
    { id: "att-bo", name: "Bo Lark", role: "Integrator", shared: true, rating: 8 },
    { id: "att-cy", name: "Cy Marlow", role: "", shared: true, rating: null },
  ];
  const lastSaved = (save: ReturnType<typeof vi.fn>) => (save.mock.calls.at(-1)![2] as { attendees: { name: string; rating: number | null }[] }).attendees;

  it("an attendee on the list sees their own row first, marked (you), and saves their own rating", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-17T00:00:00Z" } satisfies SaveOutcome);
    renderView({ save: save as unknown as SaveFn, mentionPeople: [{ id: "hub-user-1", name: "Avery Quill" }, { id: "hub-user-2", name: "Bo Lark" }], initial: loaded(3, { attendees, timer }) });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Conclude/ }));
    const groups = within(screen.getByRole("region", { name: "Ratings" })).getAllByRole("group");
    expect(groups[0].getAttribute("aria-label")).toBe("Rating for Avery Quill");
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getByTestId("ratings-waiting").textContent).toBe("Not rated yet: Avery Quill, Cy Marlow");
    fireEvent.click(screen.getByRole("button", { name: "Avery Quill: 9" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSaved(save)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Avery Quill", rating: 9 }), expect.objectContaining({ name: "Bo Lark", rating: 8 })]));
    expect(screen.getByTestId("ratings-waiting").textContent).toBe("Not rated yet: Cy Marlow");
  });

  it("someone in the meeting who is not on the attendee list still gets a row and can rate", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-17T00:00:00Z" } satisfies SaveOutcome);
    renderView({ save: save as unknown as SaveFn, mentionPeople: [{ id: "hub-user-1", name: "Dana Fenn" }, { id: "hub-user-2", name: "Bo Lark" }], initial: loaded(3, { attendees, timer }) });
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Conclude/ }));
    expect(within(screen.getByRole("region", { name: "Ratings" })).getAllByRole("group")[0].getAttribute("aria-label")).toBe("Rating for Dana Fenn");
    fireEvent.click(screen.getByRole("button", { name: "Dana Fenn: 10" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSaved(save)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Dana Fenn", rating: 10 }), expect.objectContaining({ name: "Bo Lark", rating: 8 })]));
    expect(screen.getByRole("button", { name: "Dana Fenn: 10" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("rating-average").textContent).toBe("9.0");
  });
});

// 17 Nov 2026: "SD L10 in Ask Sunny ... We don't use rocks at the GM/SD level, so the agenda for both should be:
// 1. Segue 2. Scorecard 3. To-dos 4. IDS 5. Conclude" and "Ask Sunny will need three separate district meeting spaces".
// "On the STC SD scorecard, please list each store individually with its assigned DM" with the metrics "YOY Revenue,
// Club Close, PPTA, Spa per Unique, SMS Opt-in %".
describe("the STC SD L10s", () => {
  const sd = (key: string): MeetingInfo => ({ key, name: "STC SD L10", team: "STC Salon Directors", cadence: "Thursdays · 90 min", description: "" });
  const view = (key: string, save = vi.fn() as unknown as SaveFn, doc: Record<string, unknown> = {}) =>
    render(<MeetingView info={sd(key)} initial={loaded(3, { weekEndings: ["11/08/2026", "11/15/2026"], ...doc })} save={save} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-17" dateLabel="Tue, Nov 17" />);

  it("three district meetings, each Segue, Scorecard, To-dos, IDS, Conclude, Bloom-style, without Rocks or the Reference views", async () => {
    const { MEETING_KEYS, STC_SD_KEYS } = await import("@/features/l10/lib/config");
    expect(STC_SD_KEYS).toEqual(["stc-sd-one", "stc-sd-two", "stc-sd-three"]);
    for (const key of STC_SD_KEYS) expect(MEETING_KEYS).toContain(key);
    view("stc-sd-two", vi.fn() as unknown as SaveFn, { issues: [{ id: "i1", title: "Short on staff", notes: "", resolved: false }] });
    const items = within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["1 · Segue5m", "2 · Scorecard5m", "3 · To-dos5m", "4 · IDS60m", "5 · Conclude5m"]);
    expect(document.body.textContent).toContain("Thursdays · 80 min");
    expect(screen.queryByRole("button", { name: "Business Plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /4 · IDS/ }));
    fireEvent.click(screen.getByRole("button", { name: "Short on staff", expanded: false }));
    expect(within(screen.getByRole("region", { name: "Issue detail" })).queryByRole("button", { name: "Rock" })).toBeNull();
    const { reportSections } = await import("@/features/l10/lib/report");
    expect(reportSections("stc-sd-one").map((s) => s.title)).toEqual(["Issues", "Metrics", "Meeting Recaps"]);
  });

  it("sets up the salon scorecard: each salon of the district with its DM and the five metrics, listed salon by salon", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, version: 4, updatedAt: "2026-11-17T00:00:00Z" } satisfies SaveOutcome);
    view("stc-sd-three", save as unknown as SaveFn);
    fireEvent.click(within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", { name: /Scorecard/ }));
    const setup = within(screen.getByRole("region", { name: "Set up the salon scorecard" }));
    expect(setup.getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["Lawrence", "Overland Park", "Shawnee"]);
    fireEvent.change(setup.getByLabelText("DM for these salons"), { target: { value: "Bo Lark" } });
    fireEvent.change(setup.getByLabelText("Goal for Club Close"), { target: { value: "≥ 30%" } });
    fireEvent.click(setup.getByRole("checkbox", { name: "Shawnee" }));
    fireEvent.click(setup.getByRole("button", { name: "Add 2 salons" }));

    const table = within(screen.getByTestId("bloom-scorecard"));
    expect(table.getAllByRole("rowgroup").filter((g) => g.tagName === "TBODY").map((g) => g.getAttribute("aria-label"))).toEqual(["Lawrence (Bo Lark)", "Overland Park (Bo Lark)"]);
    const lawrence = within(table.getByRole("rowgroup", { name: "Lawrence (Bo Lark)" }));
    expect(lawrence.getByRole("rowheader", { name: /Lawrence/ }).textContent).toBe("Lawrence · DM: Bo Lark");
    expect(lawrence.getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[1]?.textContent?.replace("✕", "").trim())).toEqual(["YOY Revenue", "Club Close", "PPTA", "Spa per Unique", "SMS Opt-in %"]);
    // Shawnee was left out, so the set-up stays for it.
    expect(within(screen.getByRole("region", { name: "Set up the salon scorecard" })).getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["Shawnee"]);

    await waitFor(() => expect(save).toHaveBeenCalled());
    const rows = (save.mock.calls.at(-1)![2] as { scorecard: { metric: string; owner: string; salon?: string; goal: string; goalValue: number; format: string; weeks: unknown[] }[] }).scorecard;
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r.salon === "Overland Park" && r.metric === "Club Close")).toMatchObject({ owner: "Bo Lark", goal: "≥ 30%", goalValue: 30, format: "percent", weeks: [null, null] });
  });

  it("each district lists only its own salons", async () => {
    const { SD_DISTRICT_SALONS } = await import("@/features/l10/lib/config");
    expect(SD_DISTRICT_SALONS["stc-sd-one"].map((s) => s.name)).toEqual(["Manhattan", "Lincoln O Street", "Lincoln 27th", "Lincoln Pine Lake", "Grand Island", "Kearney"]);
    expect(SD_DISTRICT_SALONS["stc-sd-two"].map((s) => s.name)).toEqual(["Omaha Maple", "Omaha Center", "Omaha Pacific", "St. Joseph", "Liberty", "Wornall"]);
    expect(SD_DISTRICT_SALONS["stc-sd-three"].map((s) => s.name)).toEqual(["Lawrence", "Overland Park", "Shawnee"]);
    const { salonByNumber } = await import("@/data/salons");
    for (const list of Object.values(SD_DISTRICT_SALONS)) for (const s of list) expect(salonByNumber(s.number)).toBeTruthy();
  });
});

// The DM L10 facilitator, 23 Nov 2026, in their words:
//  - "can you remove the timer setting on the L10 meetings? Currently, it moves us to the next section after a certain
//    timeframe, even when we aren't ready yet."
//  - the "Someone else changed this while you were editing" banner ("issues › GB for DM and Office use › resolvedAt")
//    "throughout our meeting"
//  - "i also cannot add IDS topics anymore to the DM l10 meeting."
describe("DM L10 report, 23 Nov 2026 (the DM L10 facilitator)", () => {
  it('"it moves us to the next section after a certain timeframe, even when we aren\'t ready yet": the meeting stays on its section when the planned time is over', async () => {
    vi.useFakeTimers();
    renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    });
    const before = screen.getByTestId("section-position").textContent;
    // 12 minutes: past every planned time on the agenda (the first section is planned for 5).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000);
    });
    expect(screen.getByTestId("section-position").textContent).toBe(before);
    expect(screen.queryByText(/ran out of time/)).toBeNull();
  });

  const solvedMine = { id: "i1", title: "GB for DM and Office use", notes: "", resolved: false };
  const stale = (latestDoc: Record<string, unknown>) => ({ ok: false as const, kind: "stale" as const, latest: loaded(7, latestDoc) });

  it('"issues › GB for DM and Office use › resolvedAt": both of us solving the issue shows no banner and saves', async () => {
    const save = vi.fn<() => Promise<SaveOutcome>>().mockResolvedValueOnce(stale({ issues: [{ ...solvedMine, resolved: true, resolvedSession: "s1", resolvedAt: "2026-11-23T08:10:09.000Z" }] }));
    renderView({ save: save as unknown as SaveFn, initial: loaded(3, { issues: [solvedMine] }) });
    fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Solve GB for DM and Office use" }));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
    expect(screen.queryByText(/Someone else changed this while you were editing/)).toBeNull();
  });

  describe('"i also cannot add IDS topics anymore to the DM l10 meeting": two people changing the same thing never pauses the page', () => {
    it("a real clash (we both retitled an issue) shows no banner, the page stays usable, a new topic is added and saved with the latest title", async () => {
      const save = vi
        .fn<() => Promise<SaveOutcome>>()
        .mockResolvedValueOnce(stale({ issues: [{ ...solvedMine, title: "Their title" }] }))
        .mockResolvedValue({ ok: true, version: 8, updatedAt: "t" });
      renderView({ save: save as unknown as SaveFn, initial: loaded(3, { issues: [solvedMine] }) });
      fireEvent.click(screen.getByRole("button", { name: /\d · IDS/ }));
      fireEvent.click(screen.getByRole("button", { name: /GB for DM and Office use/, expanded: false }));
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Issue title"), { target: { value: "My title" } });
      });
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(/Someone else changed this while you were editing/)).toBeNull();
      expect(document.querySelector("[inert]")).toBeNull();
      // Add topics both ways: the Identify field on the IDS page and the "+ New Issue" window.
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Identify a new issue"), { target: { value: "Topic one" } });
        fireEvent.click(screen.getByRole("button", { name: "Add issue" }));
      });
      fireEvent.click(screen.getByRole("button", { name: "+ New Issue" }));
      await act(async () => {
        fireEvent.change(within(screen.getByRole("form", { name: "New Issue" })).getByRole("textbox", { name: "New Issue" }), { target: { value: "Topic two" } });
        fireEvent.click(screen.getByRole("button", { name: "Add to IDS" }));
      });
      await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
      const doc = (save.mock.calls.at(-1) as unknown as [string, number, unknown])[2] as { issues: { title: string }[] };
      expect(doc.issues.map((i) => i.title)).toEqual(["My title", "Topic one", "Topic two"]);
    });
  });
});
