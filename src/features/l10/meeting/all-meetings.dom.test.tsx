// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SaveOutcome } from "@/features/l10/data.server";
import { MEETING_KEYS, type Roster } from "@/features/l10/lib/config";
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The owner, 23 Nov 2026: "check all meetings DM L10 SD leadership hub … when someone type something at the same time it
// should not show that banner but instead save both their work and no auto advance in any meeting tab".
// Every meeting key runs through the one MeetingView; this proves it for each key, not just the DM L10.
describe.each(MEETING_KEYS.map((k) => [k]))("meeting %s", (key) => {
  const keyInfo: MeetingInfo = { ...info, key, name: `${key} L10` };

  it("does not move to the next section when a section's planned time runs out", async () => {
    vi.useFakeTimers();
    render(<MeetingView info={keyInfo} initial={loaded()} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-13" dateLabel="Fri, Nov 13" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    });
    const before = screen.getByTestId("section-position").textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    });
    expect(screen.getByTestId("section-position").textContent).toBe(before);
  });

  it("two people changing the same thing shows no banner, freezes nothing, and saves on top of theirs", async () => {
    // Starting the meeting writes `timer`; the other person saved a different `timer` first: a real clash.
    const latest = loaded(7, { timer: { started: true, running: true, startedAt: 1, leader: "someone-else", leaderLabel: "x", leaderView: null, sessionId: "s9" } });
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, kind: "stale", latest })
      .mockResolvedValue({ ok: true, version: 8, updatedAt: "t" });
    render(<MeetingView info={keyInfo} initial={loaded()} save={save as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={0} today="2026-11-13" dateLabel="Fri, Nov 13" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect((save.mock.calls[1] as unknown as [string, number])[1]).toBe(7);
    expect(screen.queryByText(/Someone else changed this/)).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    // Not silent either: a small note says the other person's change and mine were both kept, and it blocks nothing.
    expect(screen.getByTestId("merge-note").textContent).toMatch(/Both sets of changes are saved/);
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("All changes saved"));
  });

  it("says so when live updates stop arriving, and when they are back", async () => {
    vi.useFakeTimers();
    const load = vi.fn<LoadFn>().mockRejectedValue(new Error("down"));
    render(<MeetingView info={keyInfo} initial={loaded()} save={vi.fn() as unknown as SaveFn} end={vi.fn() as unknown as EndFn} load={load as unknown as LoadFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={1000} debounceMs={0} today="2026-11-13" dateLabel="Fri, Nov 13" />);
    expect(screen.queryByTestId("sync-offline")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(screen.getByTestId("sync-offline")).toBeTruthy();
    load.mockResolvedValue({ ok: true, loaded: loaded(3) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId("sync-offline")).toBeNull();
  });

  it("sends an edit that is still waiting for its save when the page is left", async () => {
    const save = vi.fn<() => Promise<SaveOutcome>>().mockResolvedValue({ ok: true, version: 4, updatedAt: "t" });
    const { unmount } = render(<MeetingView info={keyInfo} initial={loaded()} save={save as unknown as SaveFn} end={vi.fn() as unknown as EndFn} viewer={viewer} roster={roster} hubMeetingUrl={HUB} pollMs={0} debounceMs={60_000} today="2026-11-13" dateLabel="Fri, Nov 13" />);
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    expect(save).not.toHaveBeenCalled(); // still inside the wait before the save
    unmount();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
