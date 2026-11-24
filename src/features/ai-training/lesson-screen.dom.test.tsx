// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NEWER_LESSON, OLDER_LESSON } from "@/lib/ai-training/lesson-layout.fixtures";
import type { TrainingLesson, TrainingSubmission } from "@/lib/ai-training/types";

/**
 * THE LESSON PAGE, RENDERED (Pau's layout, 20 Nov 2026): a sticky bar, then
 * Objective, Learn, Practice and Submit, each with its label chip; the steps as
 * numbered cards with the prompt and its Copy button inside; the checklist on
 * the Submit block; Previous / Next at the bottom.
 */

const submitLessonResponse = vi.fn();
vi.mock("./actions", () => ({ submitLessonResponse: (input: unknown) => submitLessonResponse(input), editMySubmission: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

const { LessonScreen } = await import("./lesson-screen");

const lesson = (bodyMd: string, over: Partial<TrainingLesson> = {}): TrainingLesson => ({
  id: "l4",
  trackId: "t1",
  moduleId: "m2",
  slug: "claude-lesson-4",
  title: "Claude Lesson 4: Build Something You Couldn't Before",
  summary: "Hey team — this is the start.",
  weekNumber: 4,
  sortOrder: 40,
  status: "published",
  publishedAt: null,
  bodyMd,
  updatedAt: "2026-11-20T00:00:00Z",
  ...over,
});

const view = (bodyMd: string, over: Partial<TrainingLesson> = {}) => ({
  lesson: lesson(bodyMd, over),
  track: { id: "t1", slug: "claude", title: "Claude Training", sortOrder: 1 },
  module: { id: "m2", trackId: "t1", slug: "m2", title: "Module 2: Building With Claude", sortOrder: 20, adminOnly: false },
});

const nav = {
  position: 4,
  total: 16,
  prev: { href: "/ai-training/claude/l3", label: "Lesson 3: Make It Prove It" },
  next: { href: "/ai-training/claude/l5", label: "Lesson 5: Wire It In and Divide the Work" },
};

afterEach(cleanup);

describe("the lesson page", () => {
  it("draws the header without repeating the lesson number in the title", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Build Something You Couldn't Before");
    expect(screen.getByText("Module 2 · Building With Claude")).toBeTruthy();
    expect(screen.getByText("Lesson 4 of 16")).toBeTruthy();
    // The intro's first line, not the card summary, sits under the title.
    expect(screen.getByText("Three lessons of moving. Lesson 4 is the payoff.")).toBeTruthy();
  });

  it("has a sticky bar to the four blocks, each with its label chip", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const bar = screen.getByRole("navigation", { name: "Lesson sections" });
    const links = within(bar).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["1 · Objective", "2 · Learn", "3 · Practice", "4 · Submit"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#lesson-objective", "#lesson-learn", "#lesson-practice", "#lesson-submit"]);
    for (const id of ["lesson-objective", "lesson-learn", "lesson-practice", "lesson-submit"]) {
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it("marks the block under the bar as you scroll", async () => {
    // jsdom lays nothing out: place the blocks by hand, all below the bar.
    const tops: Record<string, number> = { "lesson-objective": 300, "lesson-learn": 900, "lesson-practice": 1500, "lesson-submit": 2400 };
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { top: tops[this.id] ?? 5000 } as DOMRect;
    });
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    try {
      render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
      const current = () => within(screen.getByRole("navigation", { name: "Lesson sections" })).getAllByRole("link").find((a) => a.getAttribute("aria-current"))?.textContent;
      expect(current()).toBe("1 · Objective");
      Object.assign(tops, { "lesson-objective": -900, "lesson-learn": -300, "lesson-practice": 120 });
      await act(async () => {
        fireEvent.scroll(window);
      });
      expect(current()).toBe("3 · Practice");
    } finally {
      rect.mockRestore();
      raf.mockRestore();
    }
  });

  it("puts the objective, time and submission count in the Objective block", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const objective = document.getElementById("lesson-objective")!;
    expect(objective.textContent).toContain("Build a working tool your team can actually use.");
    expect(objective.textContent).toContain("45 min");
    expect(objective.textContent).toContain("1 required");
  });

  it("puts the video and 'Why this matters' together in Learn, with an Open video button", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const learn = within(document.getElementById("lesson-learn")!);
    expect(learn.getByRole("heading", { name: "Watch first" })).toBeTruthy();
    expect(learn.getByRole("link", { name: /Open video/ }).getAttribute("href")).toBe("https://anthropic.skilljar.com/claude-101");
    expect(learn.getByRole("heading", { name: "Why this matters" })).toBeTruthy();
    expect(learn.getByText("Up to now, everything AI gave you was text.")).toBeTruthy();
  });

  it("draws the assignment as numbered step cards with the prompt and Copy inside its step", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const steps = [...screen.getByRole("list", { name: "Steps" }).children] as HTMLElement[];
    expect(steps).toHaveLength(4);
    expect(within(steps[0]).getByRole("heading").textContent).toBe("Step 1: Turn It On");
    expect(within(steps[1]).getByText(/closing checklist/)).toBeTruthy();
    expect(within(steps[1]).getByRole("button", { name: "Copy prompt" })).toBeTruthy();
    expect(screen.getByText("4 steps")).toBeTruthy();
  });

  // Pau, 24 Nov 2026, on the 🔒 box after the last step: "can you align this".
  // It was drawn full width while the step cards sit past the number rail.
  it("lines the card after the steps up with the step cards, past the number rail", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const after = screen.getByTestId("lesson-practice-after");
    expect(within(after).getByText(/Before you share:/)).toBeTruthy();
    // 3rem rail + 1rem gap (sm), 2.25rem + 0.75rem below: the steps' grid columns.
    expect(after.className).toMatch(/(^|\s)ml-12(\s|$)/);
    expect(after.className).toMatch(/(^|\s)sm:ml-16(\s|$)/);
  });

  it("puts the required checklist and the Submit button on the Submit block", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const submit = within(document.getElementById("lesson-submit")!);
    const items = within(submit.getByRole("list", { name: "What to submit" })).getAllByRole("listitem");
    expect(items[0].textContent).toBe("What you built and what problem it solves");
    expect(submit.getByText("Nothing submitted yet")).toBeTruthy();
    fireEvent.click(submit.getByRole("button", { name: /Submit your work/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("saves what you submit from the Submit block", async () => {
    // Pau, 20 Nov 2026: "make sure that submissions also saves please".
    submitLessonResponse.mockResolvedValue({ ok: true });
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Submit your work/ }));
    fireEvent.change(screen.getByLabelText("Your response"), { target: { value: "My closing checklist" } });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit" }));
    });
    expect(submitLessonResponse).toHaveBeenCalledWith({ lessonId: "l4", title: "", body: "My closing checklist", linkUrl: "" });
    expect(screen.getByText(/your submission was sent for review/)).toBeTruthy();
  });

  it("says how many you have submitted and where the latest stands", () => {
    const mine = [{ id: "s1", lessonId: "l4", status: "approved" }, { id: "s0", lessonId: "l4", status: "pending" }] as TrainingSubmission[];
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={mine.map((s) => ({ ...s, lessonTitle: null, lessonHref: null, userName: "", title: "T", body: "", linkUrl: null, feedback: "", reviewedByName: null, reviewedAt: null, createdAt: "2026-11-20T00:00:00Z" }))} nav={nav} isAdmin={false} />);
    expect(within(document.getElementById("lesson-submit")!).getByText("2 submitted · Approved")).toBeTruthy();
  });

  it("links to the previous and next lessons", () => {
    render(<LessonScreen problem={null} view={view(OLDER_LESSON)} mine={[]} nav={nav} isAdmin={false} />);
    const other = within(screen.getByRole("navigation", { name: "Other lessons" }));
    expect(other.getByRole("link", { name: /Lesson 3: Make It Prove It/ }).getAttribute("href")).toBe("/ai-training/claude/l3");
    expect(other.getByRole("link", { name: /Lesson 5: Wire It In/ }).getAttribute("href")).toBe("/ai-training/claude/l5");
  });

  it("lays out the newer lesson shape the same way", () => {
    render(<LessonScreen problem={null} view={view(NEWER_LESSON, { title: "Claude Lesson 12: Hand Claude a Whole Job" })} mine={[]} nav={null} isAdmin={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hand Claude a Whole Job");
    expect(within(document.getElementById("lesson-learn")!).getByRole("heading", { name: "Read first" })).toBeTruthy();
    expect(document.getElementById("lesson-objective")!.textContent).toContain("Before you start");
    expect(screen.getByRole("list", { name: "Steps" }).children).toHaveLength(2);
    expect(screen.queryByRole("navigation", { name: "Other lessons" })).toBeNull();
  });

  it("draws a lesson it cannot sort as one card, as before", () => {
    render(<LessonScreen problem={null} view={view("Just some text with no sections.", { title: "Archived: Old" })} mine={[]} nav={null} isAdmin={false} />);
    expect(screen.queryByRole("navigation", { name: "Lesson sections" })).toBeNull();
    expect(screen.getByText("Just some text with no sections.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Submit your work/ })).toBeTruthy();
  });
});
