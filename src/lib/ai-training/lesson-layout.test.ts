import { describe, expect, it } from "vitest";

import { lessonNav } from "./catalog";
import { lessonDisplayTitle, lessonLayout, sectionKind } from "./lesson-layout";
import { NEWER_LESSON, OLDER_LESSON } from "./lesson-layout.fixtures";
import { plainText, type MdBlock } from "./markdown";
import type { TrainingCatalog } from "./types";

/**
 * THE LESSON PAGE'S FOUR BLOCKS (Pau, 20 Nov 2026): every lesson is drawn as
 * Objective → Learn → Practice → Submit, from its unchanged text. These pin
 * how both lesson shapes in the library are sorted into the blocks.
 */

const words = (blocks: MdBlock[]): string => blocks.map((b) => [plainText(b.text), b.children ? words(b.children) : ""].join(" ")).join(" ");

describe("lessonLayout — the older lesson shape", () => {
  const layout = lessonLayout(OLDER_LESSON)!;

  it("sorts it into the four blocks", () => {
    expect(layout).not.toBeNull();
    expect(plainText(layout.lede!)).toBe("Three lessons of moving. Lesson 4 is the payoff.");
    expect(words(layout.introRest)).toContain("something you couldn't build before");
    expect(words(layout.objective)).toBe("Build a working tool your team can actually use. ");
    expect(words(layout.learn)).toContain("Claude 101");
    expect(layout.learnHref).toBe("https://anthropic.skilljar.com/claude-101");
    expect(words(layout.why)).toContain("Up to now");
    expect(layout.minutes).toBe(45);
  });

  it("makes each '### Step N:' a step, its prompt inside the step it belongs to", () => {
    const steps = layout.practice.steps;
    expect(steps.map((s) => plainText(s.title))).toEqual([
      "Turn It On",
      "Build Something Real",
      "Refine It by Asking",
      "Put It In Someone's Hands",
    ]);
    expect(steps[1].blocks.some((b) => b.type === "code" && b.code?.includes("closing checklist"))).toBe(true);
    // The warning quote stays in Step 4; the 🔒 note after it closes the step list.
    expect(steps[3].blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
    expect(words(layout.practice.intro)).toContain("Four steps");
  });

  it("keeps a section the lesson adds after the steps, in Practice", () => {
    expect(layout.practice.after[0].icon).toBe("🔒");
    expect(words(layout.practice.after)).toContain("What Doesn't Come With You");
    expect(words(layout.practice.after)).toContain("Your chat history stays behind.");
  });

  it("splits the required submission into its intro, checklist and closing line", () => {
    expect(words(layout.submit.intro)).toContain("Each team member must submit");
    expect(layout.submit.checklist.map((b) => plainText(b.text))).toEqual([
      "What you built and what problem it solves",
      "A brief reflection:",
    ]);
    expect(words(layout.submit.checklist[1].children ?? [])).toContain("real person");
    expect(words(layout.submit.after)).toContain("Bullet points are fine");
  });

  it("drops only the empty 'Learning In Action' heading and the dividers", () => {
    expect(layout.tail).toEqual([]);
    const everything = JSON.stringify(layout, (_k, v) => (v instanceof Set ? [...v] : v));
    expect(everything).not.toContain("Learning In Action");
    expect(everything).not.toContain('"divider"');
  });

  it("gives the quoted prompts in Practice their Copy buttons", () => {
    const refine = layout.practice.steps[2].blocks[0];
    expect(layout.practiceIds.has(refine.id)).toBe(true);
    expect(layout.practiceIds.has(layout.objective[0].id)).toBe(false);
  });
});

describe("lessonLayout — the newer lesson shape", () => {
  const layout = lessonLayout(NEWER_LESSON)!;

  it("sorts it into the four blocks", () => {
    expect(plainText(layout.lede!)).toContain("hand Claude a whole job");
    expect(layout.introRest).toEqual([]);
    expect(words(layout.notices)).toContain("Before you start");
    expect(words(layout.objective)).toContain("Delegate one real");
    expect(words(layout.learn)).toContain("A good handoff has four parts.");
    expect(layout.learnHref).toBeNull();
    expect(layout.why).toEqual([]);
    expect(layout.minutes).toBeNull();
  });

  it("makes each bold 'Step N:' paragraph a step and puts Rules before them", () => {
    expect(layout.practice.steps.map((s) => plainText(s.title))).toEqual(["Pick the Right Job", "Write the Handoff"]);
    expect(words(layout.practice.intro)).toContain("Rules for This Lesson");
    expect(words(layout.practice.steps[1].blocks)).toContain("Go ahead through step two");
    // "Tailor it to your role" follows the steps rather than sitting inside the last one.
    expect(layout.practice.after.map((b) => b.icon)).toEqual(["🧩"]);
  });

  it("splits the submit checklist", () => {
    expect(layout.submit.intro).toEqual([]);
    expect(layout.submit.checklist).toHaveLength(2);
    expect(words(layout.submit.after)).toContain("Submit in a clear, simple format.");
  });
});

describe("lessonLayout — steps as the lessons write them", () => {
  it("takes a bold 'Part 1:' followed by an italic note, and keeps the lesson's own numbers", () => {
    const md = [
      "## 🎯 Objective", "", "x", "",
      "## 🛠️ Practice", "",
      "<b>Part 1: Quick-Fire Challenges</b> <i>(do each one)</i>", "", "- one", "",
      "<b>Part 2: Draft & Polish Writing</b>", "", "two", "",
      "<b>Option B — desktop app:</b>", "", "not a step", "",
      "## 📤 Submit", "", "- [ ] y",
    ].join("\n");
    const steps = lessonLayout(md)!.practice.steps;
    expect(steps.map((s) => [s.word, s.number, plainText(s.title)])).toEqual([
      ["Part", 1, "Quick-Fire Challenges (do each one)"],
      ["Part", 2, "Draft & Polish Writing"],
    ]);
    expect(steps[0].title.at(-1)?.italic).toBe(true);
    expect(words(steps[1].blocks)).toContain("not a step");
  });
});

describe("lessonLayout — lessons it cannot sort", () => {
  it("returns null without an objective, a practice and a submit section (the archive)", () => {
    expect(lessonLayout('<callout icon="🎓">\n### <b>Objective</b>\n</callout>\n\nDo the thing.')).toBeNull();
    expect(lessonLayout("## 🎯 Objective\n\nx\n\n## 📤 Submit\n\n- [ ] y")).toBeNull();
    expect(lessonLayout("")).toBeNull();
  });
});

describe("section names", () => {
  it.each([
    ["Objective", "objective"],
    ["This Lesson's Lesson", "learn"],
    ["This Week’s Lesson", "learn"],
    ["Learn", "learn"],
    ["Why This Matters", "why"],
    ["This Lesson's Assignment", "practice"],
    ["Practice", "practice"],
    ["Expectation (Required Submission)", "submit"],
    ["Submit", "submit"],
    ["Learning In Action", "end"],
    ["Rules for This Lesson", "other"],
  ])("%s → %s", (title, kind) => {
    expect(sectionKind(title)).toBe(kind);
  });
});

describe("lessonDisplayTitle", () => {
  it("drops the 'Claude Lesson 4:' prefix the pill already shows", () => {
    expect(lessonDisplayTitle("Claude Lesson 4: Build Something You Couldn't Before")).toBe("Build Something You Couldn't Before");
    expect(lessonDisplayTitle("Lesson 12: AI Image Generation for Your Store")).toBe("AI Image Generation for Your Store");
    expect(lessonDisplayTitle("Archived: Week 6 Assignment: Workflows")).toBe("Archived: Week 6 Assignment: Workflows");
    expect(lessonDisplayTitle("Your first Claude chat")).toBe("Your first Claude chat");
  });
});

describe("lessonNav", () => {
  const lesson = (id: string, moduleId: string, sortOrder: number, title: string, status: "published" | "draft" = "published") => ({
    id,
    trackId: "t1",
    moduleId,
    slug: id,
    title,
    summary: null,
    weekNumber: null,
    sortOrder,
    status,
    publishedAt: null,
  });
  const catalog: TrainingCatalog = {
    tracks: [{ id: "t1", slug: "claude", title: "Claude Training", sortOrder: 1 }],
    modules: [
      { id: "m1", trackId: "t1", slug: "m1", title: "Module 1: Making the Move", sortOrder: 10, adminOnly: false },
      { id: "m2", trackId: "t1", slug: "m2", title: "Module 2: Building", sortOrder: 20, adminOnly: false },
      { id: "arch", trackId: "t1", slug: "arch", title: "Archive", sortOrder: 70, adminOnly: true },
    ],
    lessons: [
      lesson("l3", "m2", 1, "Claude Lesson 3: Make It Prove It"),
      lesson("l1", "m1", 1, "Claude Lesson 1: Making the Move"),
      lesson("l2", "m1", 2, "Claude Lesson 2: Rebuild"),
      lesson("old", "arch", 1, "Archived: Old"),
      lesson("draft", "m2", 2, "Claude Lesson 4: Draft", "draft"),
    ],
  };

  it("numbers the track's published lessons in landing-page order, archive left out", () => {
    expect(lessonNav(catalog, "claude", "l2", lessonDisplayTitle)).toEqual({
      position: 2,
      total: 3,
      prev: { href: "/ai-training/claude/l1", label: "Lesson 1: Making the Move" },
      next: { href: "/ai-training/claude/l3", label: "Lesson 3: Make It Prove It" },
    });
    expect(lessonNav(catalog, "claude", "l3", lessonDisplayTitle)?.next).toBeNull();
  });

  it("has no place for an archived or draft lesson", () => {
    expect(lessonNav(catalog, "claude", "old", lessonDisplayTitle)).toBeNull();
    expect(lessonNav(catalog, "claude", "draft", lessonDisplayTitle)).toBeNull();
    expect(lessonNav(catalog, "chatgpt", "l1", lessonDisplayTitle)).toBeNull();
  });
});
