import { describe, expect, it } from "vitest";
import { mergeThreeWay } from "./merge";

// Madeline Patterson (DM L10 facilitator), 23 Nov 2026: the meeting page said "Someone else changed this while you were
// editing … issues › GB for DM and Office use › resolvedAt" and paused until she chose, all meeting.
const issue = (over: Record<string, unknown>) => ({ id: "i1", title: "GB for DM and Office use", notes: "", resolved: false, ...over });

describe("two people solving the same issue is not a clash", () => {
  const base = { issues: [issue({})] };
  const mine = { issues: [issue({ resolved: true, resolvedSession: "s1", resolvedAt: "2026-11-23T08:10:05.000Z" })] };
  const theirs = { issues: [issue({ resolved: true, resolvedSession: "s1", resolvedAt: "2026-11-23T08:10:09.000Z" })] };

  it("has no conflict, whichever side is preferred, and keeps the earlier solve time", () => {
    for (const prefer of ["remote", "local"] as const) {
      const r = mergeThreeWay(base, mine, theirs, "", prefer);
      expect(r.conflicts).toEqual([]);
      expect((r.merged as typeof base).issues[0]).toMatchObject({ resolved: true, resolvedAt: "2026-11-23T08:10:05.000Z" });
    }
  });

  it("still asks when one person solved it and the other reopened or edited it", () => {
    const retitledMine = { issues: [issue({ title: "My title" })] };
    const retitledTheirs = { issues: [issue({ title: "Their title" })] };
    expect(mergeThreeWay(base, retitledMine, retitledTheirs).conflicts.length).toBeGreaterThan(0);
    const solvedBase = { issues: [issue({ resolved: true, resolvedSession: "s0", resolvedAt: "2026-11-22T08:00:00.000Z" })] };
    const reopenedByMe = { issues: [issue({ resolved: false, resolvedSession: null })] };
    const reSolvedByThem = { issues: [issue({ resolved: true, resolvedSession: "s1", resolvedAt: "2026-11-23T08:10:09.000Z" })] };
    expect(mergeThreeWay(solvedBase, reopenedByMe, reSolvedByThem).conflicts.length).toBeGreaterThan(0);
  });
});
