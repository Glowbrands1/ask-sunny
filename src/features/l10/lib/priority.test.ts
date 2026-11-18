import { describe, expect, it } from "vitest";

import { byPriority, priorityNumbers, togglePriority } from "./priority";
import type { Issue } from "./types";

// Numbered IDS priorities (the owner, 17 Nov 2026; port from Ask Bubbles). Invented issues.
const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({ id, title: id, notes: "", resolved: false, ...extra });

describe("numbered priorities", () => {
  it("numbers the marked issues 1, 2, 3 in the order they were picked, not the list order", () => {
    let xs = [issue("a"), issue("b"), issue("c")];
    for (const id of ["c", "a", "b"]) xs = togglePriority(xs, id);
    expect([...priorityNumbers(xs)]).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
    expect(byPriority(xs, priorityNumbers(xs)).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("clearing one, or solving it, closes the gap; each list (short / long-term) has its own 1, 2, 3", () => {
    let xs = [issue("a"), issue("b"), issue("c"), issue("l", { term: "long" })];
    for (const id of ["a", "b", "c", "l"]) xs = togglePriority(xs, id);
    xs = togglePriority(xs, "a");
    expect(xs.find((i) => i.id === "a")).not.toHaveProperty("priorityOrder");
    expect(Object.fromEntries(priorityNumbers(xs))).toEqual({ b: 1, c: 2, l: 1 });
    xs = xs.map((i) => (i.id === "b" ? { ...i, resolved: true } : i));
    expect(Object.fromEntries(priorityNumbers(xs))).toEqual({ c: 1, l: 1 });
  });

  it("an issue marked before numbering (the Hub's \"!\", no order) counts as picked first", () => {
    let xs = [issue("a"), issue("old", { priority: true })];
    xs = togglePriority(xs, "a");
    expect(Object.fromEntries(priorityNumbers(xs))).toEqual({ old: 1, a: 2 });
  });
});
