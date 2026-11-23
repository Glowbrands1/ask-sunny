// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
});

/**
 * Two people in the same meeting at once, against one shared stand-in for the Hub's record (version-checked saves,
 * like the real one): nothing either of them does is lost, nobody sees a banner, nothing freezes.
 * Madeline Patterson (DM L10), 23 Nov 2026, and the owner: "when someone type something at the same time it should not
 * show that banner but instead save both their work".
 */
function sharedHub(doc: Record<string, unknown>) {
  const rec = { version: 3, doc };
  const save = vi.fn(async (_k: string, expected: number, next: Record<string, unknown>): Promise<SaveOutcome> => {
    await new Promise((r) => setTimeout(r, 5));
    if (expected !== rec.version) return { ok: false, kind: "stale", latest: { version: rec.version, updatedAt: null, doc: rec.doc } };
    rec.version += 1;
    rec.doc = JSON.parse(JSON.stringify(next));
    return { ok: true, version: rec.version, updatedAt: "t" };
  });
  const load = vi.fn(async () => ({ ok: true as const, loaded: { version: rec.version, updatedAt: null, doc: rec.doc } }));
  return { rec, save, load };
}

describe.each(MEETING_KEYS.map((k) => [k]))("meeting %s: two people at once", (key) => {
  it("both people's IDS work is saved: one solves an issue, the other adds topics, both retitle the same issue", async () => {
    const issue = { id: "i1", title: "GB for DM and Office use", notes: "", resolved: false };
    const hub = sharedHub({ issues: [issue, { id: "i2", title: "Second", notes: "", resolved: false }] });
    const screenFor = (id: string, name: string) => {
      const { container } = render(
        <MeetingView info={{ ...info, key, name: `${key} L10` }} initial={{ version: 3, updatedAt: null, doc: hub.rec.doc }} save={hub.save as unknown as SaveFn} end={vi.fn() as unknown as EndFn} load={hub.load as unknown as LoadFn} viewer={{ id, label: name, name }} roster={roster} hubMeetingUrl={HUB} pollMs={30} debounceMs={10} today="2026-11-13" dateLabel="Fri, Nov 13" />,
      );
      const w = within(container);
      fireEvent.click(w.getByRole("button", { name: /\d · IDS/ }));
      return w;
    };
    const a = screenFor("hub-user-1", "Avery");
    const b = screenFor("hub-user-2", "Bo");

    // At the same moment: Avery solves i1 and retitles i2; Bo adds two topics and also retitles i2.
    await act(async () => {
      fireEvent.click(a.getByRole("button", { name: "Solve GB for DM and Office use" }));
      fireEvent.change(b.getByLabelText("Identify a new issue"), { target: { value: "Bo's first topic" } });
      fireEvent.click(b.getByRole("button", { name: "Add issue" }));
      fireEvent.change(b.getByLabelText("Identify a new issue"), { target: { value: "Bo's second topic" } });
      fireEvent.click(b.getByRole("button", { name: "Add issue" }));
    });
    // Both open the same issue, then both retitle it at the same moment.
    fireEvent.click(a.getByRole("button", { name: /^Second$/, expanded: false }));
    fireEvent.click(b.getByRole("button", { name: /^Second$/, expanded: false }));
    await act(async () => {
      fireEvent.change(a.getByLabelText("Issue title"), { target: { value: "Second (Avery)" } });
      fireEvent.change(b.getByLabelText("Issue title"), { target: { value: "Second (Bo)" } });
    });

    // Both screens settle on the same saved record with everyone's work in it.
    await waitFor(
      () => {
        const issues = (hub.rec.doc as { issues: { title: string; resolved: boolean }[] }).issues;
        expect(issues.find((i) => i.title === "GB for DM and Office use")?.resolved).toBe(true);
        expect(issues.map((i) => i.title)).toEqual(expect.arrayContaining(["Bo's first topic", "Bo's second topic"]));
        // The one value both changed: the latest save wins (one of the two, never lost to a pause).
        expect(issues.some((i) => i.title === "Second (Avery)" || i.title === "Second (Bo)")).toBe(true);
        expect(a.getByTestId("save-status").textContent).toBe("All changes saved");
        expect(b.getByTestId("save-status").textContent).toBe("All changes saved");
      },
      { timeout: 4000 },
    );
    expect(document.body.textContent).not.toContain("Someone else changed this while you were editing");
    expect(document.querySelector("[inert]")).toBeNull();
  });
});
