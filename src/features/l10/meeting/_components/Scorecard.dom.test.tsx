// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { OWNER_COLORS, ownerColor } from "@/features/l10/lib/bloom";
import type { MeetingDoc } from "@/features/l10/lib/types";
import { Scorecard } from "./Scorecard";

// The owner's feedback on the DM L10 scorecard (15 Nov 2026), as in the Leadership Hub (#98). Invented names only.
const row = (id: string, metric: string, owner: string, weeks: (number | null)[]) => ({ id, metric, owner, goal: "≥ 5", goalValue: 5, higherIsBetter: true, format: "number", weeks });
const start = () =>
  ({
    weekEndings: ["11/01/2026", "11/08/2026", "11/15/2026"],
    scorecard: [row("s1", "Sales calls", "Avery Quill", [4, 6, null]), row("s2", "Reviews", "Bo Lark", [7, 2, 5]), row("s3", "Visits", "Avery Quill", [5, 5, 9])],
  }) as unknown as MeetingDoc;

const saved: MeetingDoc[] = [];
function Harness() {
  const [doc, setDoc] = useState(start);
  const edit = (fn: (d: MeetingDoc) => MeetingDoc) =>
    setDoc((d) => {
      const next = fn(d);
      saved.push(next);
      return next;
    });
  return <Scorecard doc={doc} edit={edit} people={["Avery Quill", "Bo Lark"]} bloom today="2026-11-12" />;
}

afterEach(() => {
  cleanup();
  saved.length = 0;
});

describe("Bloom-style scorecard (the owner's feedback)", () => {
  // Changed on purpose 18 Nov 2026 (port from Ask Bubbles): the form was always open at the top; it now opens from an
  // "Add metric" button next to "Add week" (the tests below).
  it('"Add metric" opens the form above the table, and saves a row with name, owner, goal, unit and direction', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add metric", expanded: false }));
    const form = screen.getByTestId("add-metric");
    expect(form.compareDocumentPosition(screen.getByTestId("bloom-scorecard")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const f = within(form);
    fireEvent.change(f.getByLabelText("Metric name"), { target: { value: "Callbacks" } });
    fireEvent.change(f.getByLabelText("Metric owner"), { target: { value: "Bo Lark" } });
    fireEvent.change(f.getByLabelText("Goal"), { target: { value: "≤ 3" } });
    fireEvent.change(f.getByLabelText("Format"), { target: { value: "number" } });
    fireEvent.change(f.getByLabelText("Direction"), { target: { value: "lower" } });
    fireEvent.click(f.getByRole("button", { name: "Add metric" }));
    expect(saved.at(-1)!.scorecard.at(-1)).toMatchObject({ metric: "Callbacks", owner: "Bo Lark", goal: "≤ 3", goalValue: 3, format: "number", higherIsBetter: false, weeks: [null, null, null] });
  });

  it('make "add a week" button visible please and make this collapasable (the owner, 18 Nov 2026)', () => {
    render(<Harness />);
    const toolbar = within(screen.getByTestId("scorecard-toolbar"));
    // "+ Add week" first, a filled button; it adds a week.
    const buttons = toolbar.getAllByRole("button");
    expect(buttons[0].textContent).toBe("+ Add week");
    expect(buttons[0].className).not.toBe(toolbar.getByRole("button", { name: "Add metric" }).className);
    fireEvent.click(buttons[0]);
    expect(saved.at(-1)!.weekEndings).toHaveLength(4);
    // The Add metric form is closed until asked for, and closes again.
    expect(screen.queryByTestId("add-metric")).toBeNull();
    fireEvent.click(toolbar.getByRole("button", { name: "Add metric", expanded: false }));
    expect(screen.getByTestId("add-metric")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("add-metric")).getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("add-metric")).toBeNull();
  });

  it("wide have the option to do that (the owner, 18 Nov 2026): Full width / Collapse", () => {
    function Wide() {
      const [wide, setWide] = useState(false);
      return (
        <>
          <span data-testid="wide">{String(wide)}</span>
          <Scorecard doc={start()} edit={() => {}} people={["Avery Quill"]} bloom today="2026-11-12" wide={wide} onWide={setWide} />
        </>
      );
    }
    render(<Wide />);
    fireEvent.click(screen.getByRole("button", { name: "⤢ Full width", pressed: false }));
    expect(screen.getByTestId("wide").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "⤡ Collapse", pressed: true }));
    expect(screen.getByTestId("wide").textContent).toBe("false");
  });

  it("week headers show the range on two lines, start over end, newest first", () => {
    render(<Harness />);
    const weeks = within(screen.getByTestId("bloom-scorecard")).getAllByRole("columnheader").slice(3);
    expect(weeks.map((h) => [h.querySelector("[data-week-start]")?.textContent, h.querySelector("[data-week-end]")?.textContent])).toEqual([
      ["9 Nov", "15 Nov"],
      ["2 Nov", "8 Nov"],
      ["26 Oct", "1 Nov"],
    ]);
    expect(weeks[0].textContent).toBe("9 Nov / 15 Nov"); // screen readers still hear the range
  });

  it("the current week's column is marked in its header and in every cell, not just the header", () => {
    render(<Harness />);
    const table = screen.getByTestId("bloom-scorecard");
    const heads = within(table).getAllByRole("columnheader");
    const col = heads.findIndex((h) => h.hasAttribute("data-current-week"));
    expect(heads[col].textContent).toBe("9 Nov / 15 Nov");
    // The group divider rows (19 Nov 2026) are one heading cell across the table; the metric rows are checked.
    for (const r of within(table).getAllByRole("row").slice(1).filter((x) => !x.hasAttribute("data-group-row"))) {
      const cells = within(r).getAllByRole("cell");
      expect(cells[col].hasAttribute("data-current-week")).toBe(true);
      expect(cells.filter((c) => c.hasAttribute("data-current-week"))).toHaveLength(1);
    }
  });

  it("the same owner always gets the same colour, on every row", () => {
    render(<Harness />);
    const avery = within(screen.getByTestId("bloom-scorecard")).getAllByTitle("Avery Quill").map((a) => a.getAttribute("data-owner-color"));
    expect(new Set(avery)).toEqual(new Set([String(ownerColor("Avery Quill"))]));
    expect(ownerColor("Avery Quill")).toBe(ownerColor("  avery   QUILL "));
    const names = ["Avery Quill", "Bo Lark", "Cy Marlow", "Dee Wren", "Eli Sorrel", "Fay Linden", "Gus Hollow", "Hal Brook"];
    expect(new Set(names.map(ownerColor)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("the Bloom-style header (the owner, 16 Nov 2026: \"this kinda hurts my eyes the yellow\")", () => {
  it("is white text on black, not yellow", () => {
    render(<Harness />);
    const head = screen.getByTestId("bloom-scorecard-head");
    expect(head.className).toContain("text-white");
    expect(head.className).not.toContain("text-gold-head");
  });
});

describe("Scorecard accents in Ask Sunny's yellow (inside .hub-l10)", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const at = css.indexOf("THE SCORECARD'S ACCENTS");
  const section = css.slice(at, css.indexOf("/* ── Glass utilities", at));
  const hex = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))![1];
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = (a: string, b: string, p: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, "0")).join("");

  it("declares --week-current and all six owner colours inside .hub-l10 from Ask Sunny's tokens, with no new colour values", () => {
    expect(at).toBeGreaterThan(-1);
    expect(section).toMatch(/\.hub-l10 \{\s*--week-current: color-mix\(in srgb, var\(--approved-brand-yellow\)/);
    for (let n = 1; n <= OWNER_COLORS; n++) {
      expect(section).toMatch(new RegExp(`--owner-${n}-bg: [^;]*var\\(--`));
      expect(section).toMatch(new RegExp(`\\.hub-l10 \\[data-owner-color="${n}"\\] \\{ background-color: var\\(--owner-${n}-bg\\)`));
    }
    expect(section.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  });

  it("keeps the initials and the current week's text at 4.5:1 or more", () => {
    const [y, yi, amber, card, ink] = [hex("approved-brand-yellow"), hex("approved-yellow-ink"), hex("approved-yellow-label"), hex("approved-card"), "#0a0a0a"];
    const pairs: [string, string][] = [
      [yi, mix(y, card, 0.25)],
      [yi, mix(y, card, 0.55)],
      [yi, y],
      [y, ink],
      [card, amber],
      [amber, card],
      [ink, mix(y, card, 0.18)], // a figure in the current week's column
      // Changed on purpose 16 Nov 2026: the header is white on black (the owner's choice), so this week's head is the
      // slate --approved-border-band behind white text, not a yellow-and-ink mix.
      [card, hex("approved-border-band")], // the current week's header
      [card, ink], // the other headers: white on black
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("STC SD L10 scorecard: a divider around each salon (QA, 19 Nov 2026)", () => {
  // "Is there also a way we can create some distinction around each salon, maybe a divider? It will make it easier to
  // view-- and we will want that on bubbles too." Her screenshot: the Hub's own setup, rows named "Manhattan · YOY
  // Revenue" with no salon tag, all one owner, so they ran together. Invented DM name.
  const salons = [
    { number: "0462", name: "Manhattan" },
    { number: "0311", name: "Lincoln O Street" },
  ];
  const hubRows = () =>
    ["Manhattan", "Lincoln O Street"].flatMap((s, si) =>
      ["YOY Revenue", "Club Close", "PPTA", "Spa per Unique", "SMS Opt-in %"].map((m, mi) => row(`h${si}${mi}`, `${s} · ${m}`, "Bo Lark", [null, null, null])),
    );
  const renderWith = (scorecard: ReturnType<typeof row>[]) => {
    const doc = { weekEndings: ["11/01/2026", "11/08/2026", "11/15/2026"], scorecard } as unknown as MeetingDoc;
    return render(<Scorecard doc={doc} edit={() => {}} people={["Bo Lark"]} bloom today="2026-11-12" salons={salons} />);
  };

  it("rows the Hub named '<salon> · <metric>' sit under a divider row per salon, the metric without the salon again", () => {
    renderWith(hubRows());
    const table = screen.getByTestId("bloom-scorecard");
    const dividers = [...table.querySelectorAll("[data-salon-row]")].map((r) => r.textContent);
    expect(dividers).toEqual(["Manhattan · DM: Bo Lark", "Lincoln O Street · DM: Bo Lark"]);
    const manhattan = within(screen.getByRole("rowgroup", { name: "Manhattan (Bo Lark)" }));
    expect(manhattan.getByRole("button", { name: "Remove metric Manhattan · YOY Revenue" }).closest("td")!.textContent).toBe("YOY Revenue✕");
    expect(manhattan.getAllByRole("row")).toHaveLength(6);
  });

  it("does not offer to set up again the salons the Hub already set up (one district's scorecard had every salon twice)", () => {
    renderWith(hubRows());
    expect(screen.queryByRole("region", { name: "Set up the salon scorecard" })).toBeNull();
  });

  it("a metric named like a salon that is not this meeting's stays with its owner", () => {
    renderWith([row("x", "Omaha Maple · PPTA", "Bo Lark", [null, null, null])]);
    expect(screen.getByTestId("bloom-scorecard").querySelector("[data-salon-row]")).toBeNull();
    expect(screen.getByRole("rowgroup", { name: "Bo Lark's metrics" })).toBeTruthy();
  });

  it("every owner's group starts with a divider row naming it, too", () => {
    render(<Harness />);
    const heads = [...screen.getByTestId("bloom-scorecard").querySelectorAll("[data-group-row]")].map((r) => r.textContent);
    expect(heads).toEqual(["Avery Quill", "Bo Lark"]);
  });
});

// The Hub's silent-failure audit, 23 Nov 2026: a scorecard entry that is not a number ("n/a", "12x") closed the cell and
// went back to the old value without a word.
describe("a scorecard entry that is not a number", () => {
  it("is not dropped quietly: the cell stays open, says so, and Escape cancels", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Sales calls/ })[0]);
    const input = screen.getByRole("textbox", { name: /^Sales calls/ });
    fireEvent.change(input, { target: { value: "n/a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/Not a number/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(saved).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /^Sales calls/ })).toBeNull();
  });
  it("a valid number still saves", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Sales calls/ })[0]);
    const input = screen.getByRole("textbox", { name: /^Sales calls/ });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(saved.length).toBeGreaterThan(0);
  });
});
