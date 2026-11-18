// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrainingHomeData } from "./training-home";

/**
 * THE AI TRAINING SCREEN, RENDERED. Track cards, lessons grouped by module,
 * search, and an imported Notion lesson drawn as blocks with its Copy buttons.
 */

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
  usePathname: () => "/ai-training",
  useSearchParams: () => search,
}));
vi.mock("./actions", () => ({ editMySubmission: vi.fn() }));

const { TrainingHome } = await import("./training-home");
const { TrainingMarkdown } = await import("./training-markdown");

const data: TrainingHomeData = {
  catalog: {
    tracks: [
      { id: "t1", slug: "claude", title: "Claude Training", sortOrder: 1 },
      { id: "t2", slug: "chatgpt", title: "ChatGPT Training", sortOrder: 2 },
    ],
    modules: [{ id: "m1", trackId: "t2", slug: "m1", title: "Module 1: Getting Started", sortOrder: 1, adminOnly: false }],
    lessons: [
      { id: "l1", trackId: "t1", moduleId: null, slug: "week-1", title: "Your first Claude chat", summary: "Say hello", weekNumber: 1, sortOrder: 1, status: "published", publishedAt: null },
      { id: "l2", trackId: "t2", moduleId: "m1", slug: "prompts", title: "Writing better prompts", summary: null, weekNumber: null, sortOrder: 1, status: "published", publishedAt: null },
    ],
  },
  policy: { key: "policy", title: "AI Policy", bodyMd: "## Never paste\nGuest **card numbers**.", updatedAt: null },
  bestPractices: null,
  announcement: { key: "announcement", title: "Announcement", bodyMd: "Lesson 5 is live!", updatedAt: null },
  mine: [],
};

afterEach(() => {
  cleanup();
  replace.mockReset();
  search = new URLSearchParams();
});

describe("the AI Training screen", () => {
  it("shows the announcement, both tracks and the first track's lessons", () => {
    render(<TrainingHome isAdmin={false} problem={null} data={data} />);
    expect(screen.getByText("Lesson 5 is live!")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Claude Training/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ChatGPT Training/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Your first Claude chat/ }).getAttribute("href")).toBe("/ai-training/claude/week-1");
    expect(screen.queryByText("Writing better prompts")).toBeNull();
    expect(screen.queryByRole("link", { name: /Manage training/ })).toBeNull();
  });

  it("switches track through the address, so the choice can be shared", () => {
    render(<TrainingHome isAdmin={false} problem={null} data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /ChatGPT Training/ }));
    expect(replace).toHaveBeenCalledWith("/ai-training?track=chatgpt", { scroll: false });
  });

  it("groups a track's lessons under their module", () => {
    search = new URLSearchParams("track=chatgpt");
    render(<TrainingHome isAdmin={false} problem={null} data={data} />);
    expect(screen.getByText("Module 1")).toBeTruthy();
    expect(screen.getByText("Getting Started")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Writing better prompts/ })).toBeTruthy();
  });

  it("offers Manage training to administrators only", () => {
    render(<TrainingHome isAdmin problem={null} data={data} />);
    expect(screen.getByRole("link", { name: /Manage training/ }).getAttribute("href")).toBe("/ai-training/manage");
  });

  it("says plainly when it cannot load, rather than showing an empty program", () => {
    render(<TrainingHome isAdmin={false} problem="AI Training could not be loaded." data={null} />);
    expect(screen.getByText("AI Training could not be loaded.")).toBeTruthy();
  });
});

describe("a lesson's content", () => {
  it("draws callouts, lists and a copyable prompt in a Practice section", () => {
    const md = [
      '<callout icon="🎓" color="orange_bg">',
      "\tBy the end you can draft an email.",
      "</callout>",
      "## 🛠️ Practice",
      "- Ask: \"Draft a friendly reminder email about Saturday's team meeting\"",
      "```",
      "Summarise this in three bullets",
      "```",
      "[Old link](/assignments/claude/week-2)",
    ].join("\n");
    const { container } = render(<TrainingMarkdown md={md} promptCopies />);
    expect(container.querySelector(".training-callout-orange")?.textContent).toContain("draft an email");
    expect(screen.getAllByRole("button", { name: "Copy prompt" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Old link" }).getAttribute("href")).toBe("/ai-training/claude/week-2");
  });

  it("never renders a script link", () => {
    render(<TrainingMarkdown md={"[click](javascript:alert`1`)"} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click")).toBeTruthy();
  });
});
