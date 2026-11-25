// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SaveOutcome } from "@/features/l10/data.server";
import { MEETING_KEYS, type Roster } from "@/features/l10/lib/config";
import type { EndFn } from "./_components/Conclude";
import { MeetingView } from "./MeetingView";
import type { LoadFn, SaveFn } from "./useMeetingSync";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

/*
 * The owner, 24 Nov 2026: "check all meetings tab … 2 or more people should be able to save and use the apps and tabs
 * and meeting simultaneously". Three people in every meeting at once, against one shared stand-in for the Hub's record
 * (version-checked saves, like the real one). Invented people and data only.
 *
 * The test finds each meeting's tabs and fields itself (the meetings differ: Rocks, Headlines, Bloom-style pages), so a
 * tab added later is covered too. First one person works through every tab alone, to learn what each tab saves. Then
 * three people work at the same moment, each in a different tab, every round, until each has used every tab: every
 * entry each of them typed must be in the saved record, nobody sees a banner, nothing freezes. Last, all three add an
 * IDS topic at the same moment, and all three solve the same topic at the same moment. Only empty fields are typed into, so no one overwrites a value someone else wrote
 * (where two people change the very same value, the latest save wins by design: two-people.dom.test.tsx).
 */
const roster: Roster = {
  members: [
    { first: "Avery", name: "Avery Quill", role: "Visionary" },
    { first: "Bo", name: "Bo Lark", role: "Integrator" },
    { first: "Cy", name: "Cy Marlow", role: "" },
  ],
  leader: "Bo Lark",
};
const PEOPLE = [
  { id: "hub-user-1", label: "avery@example.test", name: "Avery" },
  { id: "hub-user-2", label: "bo@example.test", name: "Bo" },
  { id: "hub-user-3", label: "cy@example.test", name: "Cy" },
];
const HUB = "https://hub.example.test/meetings/x";

afterEach(() => {
  cleanup();
});

function sharedHub() {
  const rec: { version: number; doc: Record<string, unknown> } = { version: 1, doc: {} };
  const save = vi.fn(async (_k: string, expected: number, next: Record<string, unknown>): Promise<SaveOutcome> => {
    await new Promise((r) => setTimeout(r, 3));
    if (expected !== rec.version) return { ok: false, kind: "stale", latest: { version: rec.version, updatedAt: null, doc: rec.doc } };
    rec.version += 1;
    rec.doc = JSON.parse(JSON.stringify(next));
    return { ok: true, version: rec.version, updatedAt: "t" };
  });
  const load = vi.fn(async () => ({ ok: true as const, loaded: { version: rec.version, updatedAt: null, doc: rec.doc } }));
  return { rec, save, load };
}

type Screen = { w: ReturnType<typeof within>; root: HTMLElement };

function open(key: string, hub: ReturnType<typeof sharedHub>, person: (typeof PEOPLE)[number]): Screen {
  const { container } = render(
    <MeetingView
      info={{ key, name: `${key} L10`, team: "Team", cadence: "Tuesdays · 90 min", description: "" }}
      initial={{ version: hub.rec.version, updatedAt: null, doc: hub.rec.doc }}
      save={hub.save as unknown as SaveFn}
      end={vi.fn() as unknown as EndFn}
      load={hub.load as unknown as LoadFn}
      viewer={person}
      roster={roster}
      hubMeetingUrl={HUB}
      pollMs={20}
      debounceMs={5}
      today="2026-11-24"
      dateLabel="Tue, Nov 24"
    />,
  );
  return { w: within(container), root: container };
}

const tabNames = (s: Screen) => s.w.getAllByRole("button").map((b: HTMLElement) => b.textContent ?? "").filter((t: string) => /^\d+ · /.test(t));
const goTo = (s: Screen, tab: string) => fireEvent.click(s.w.getAllByRole("button").find((b: HTMLElement) => b.textContent === tab)!);

/** Types a unique entry into every empty text field on this tab, pressing Enter, then presses the tab's Add buttons. */
const labelOf = (f: Element) => (f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.getAttribute("name") || "field").replace(/[|]/g, "");
function workTab(s: Screen, marker: (i: number, label: string) => string): string[] {
  const fields = [...s.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => {
    const type = f.getAttribute("type") ?? "text";
    const label = `${f.getAttribute("aria-label") ?? ""} ${f.getAttribute("placeholder") ?? ""}`;
    return (type === "text" || f.tagName === "TEXTAREA") && !f.disabled && !f.readOnly && f.value === "" && !/search/i.test(label);
  });
  const typed: string[] = [];
  fields.forEach((f, i) => {
    const m = marker(i, labelOf(f));
    fireEvent.change(f, { target: { value: m } });
    fireEvent.keyDown(f, { key: "Enter", code: "Enter" });
    typed.push(m);
  });
  for (const b of s.w.queryAllByRole("button")) if (/^Add\b/.test(b.textContent ?? "") && !(b as HTMLButtonElement).disabled) fireEvent.click(b);
  return typed;
}

/** Waits until every screen has saved and the record has stopped changing long enough for every screen to pull it. */
const settle = async (screens: Screen[], hub: ReturnType<typeof sharedHub>) => {
  let seen = -1;
  for (let quiet = 0; quiet < 3; ) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    await waitFor(
      () => {
        for (const s of screens) expect(s.w.getByTestId("save-status").textContent).toBe("All changes saved");
      },
      { timeout: 5000 },
    );
    quiet = hub.rec.version === seen ? quiet + 1 : 0;
    seen = hub.rec.version;
  }
  return JSON.stringify(hub.rec.doc);
};

const noBannerNoFreeze = () => {
  expect(document.body.textContent).not.toContain("Someone else changed this while you were editing");
  expect(document.body.textContent).not.toContain("choose below");
  expect(document.querySelector("[inert]")).toBeNull();
};

describe.each(MEETING_KEYS.map((k) => [k]))("meeting %s: three people at once, in every tab", (key) => {
  it("every entry each person makes in every tab is saved, with no banner and nothing frozen", async () => {
    // 1. One person alone: what does each tab save?
    const solo = sharedHub();
    const one = open(key, solo, PEOPLE[0]);
    const tabs = tabNames(one);
    expect(tabs.length).toBeGreaterThan(2);
    const savesPerTab: number[] = [];
    const savedLabels = new Set<string>();
    for (const [t, tab] of tabs.entries()) {
      goTo(one, tab);
      let typed: string[] = [];
      await act(async () => {
        typed = workTab(one, (i, label) => `SOLO|${label}|t${t}f${i}|`);
      });
      const doc = await settle([one], solo);
      const kept = typed.filter((m) => doc.includes(m));
      kept.forEach((m) => savedLabels.add(m.split("|")[1]));
      savesPerTab.push(kept.length);
    }
    expect(savesPerTab.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    cleanup();

    // 2. Three people, each in a different tab at the same moment, round after round.
    const hub = sharedHub();
    const screens = PEOPLE.map((p) => open(key, hub, p));
    const typedBy: string[][][] = PEOPLE.map(() => tabs.map(() => []));
    for (let round = 0; round < tabs.length; round++) {
      await act(async () => {
        screens.forEach((s, n) => goTo(s, tabs[(round + n) % tabs.length]));
      });
      await act(async () => {
        screens.forEach((s, n) => {
          const t = (round + n) % tabs.length;
          typedBy[n][t] = workTab(s, (i, label) => `P${n}|${label}|t${t}f${i}|`);
        });
      });
      await settle(screens, hub);
      noBannerNoFreeze();
    }
    const doc = await settle(screens, hub);
    PEOPLE.forEach((p, n) =>
      tabs.forEach((tab: string, t: number) => {
        // Every entry of a kind the page saves for one person alone is saved for each of three people at once.
        const lost = typedBy[n][t].filter((m) => savedLabels.has(m.split("|")[1]) && !doc.includes(m));
        expect(lost, `${p.name} in "${tab}"`).toEqual([]);
      }),
    );

    // 3. All three add an IDS topic in the same moment.
    const ids = tabs.find((t: string) => /IDS|Issues/.test(t))!;
    await act(async () => {
      screens.forEach((s) => goTo(s, ids));
    });
    await act(async () => {
      screens.forEach((s, n) => {
        fireEvent.change(s.w.getByLabelText("Identify a new issue"), { target: { value: `Topic from ${PEOPLE[n].name}` } });
        fireEvent.click(s.w.getByRole("button", { name: "Add issue" }));
      });
    });
    const after = await settle(screens, hub);
    for (const p of PEOPLE) expect(after).toContain(`Topic from ${p.name}`);
    noBannerNoFreeze();

    // 4. All three solve the same topic in the same moment (the DM L10's "issues › … › resolvedAt" banner).
    await act(async () => {
      screens.forEach((s) => fireEvent.click(s.w.getByRole("button", { name: "Solve Topic from Avery" })));
    });
    await settle(screens, hub);
    const issues = (hub.rec.doc as { issues: { title: string; resolved: boolean }[] }).issues;
    expect(issues.find((i) => i.title === "Topic from Avery")?.resolved).toBe(true);
    for (const p of PEOPLE) expect(issues.some((i) => i.title === `Topic from ${p.name}`)).toBe(true);
    noBannerNoFreeze();
  }, 60_000);
});
