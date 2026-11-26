import { describe, expect, it } from "vitest";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import type { PermissionMatrix } from "@/types";

import {
  NEW_LESSON_KIND,
  NEW_MODULE_KIND,
  announcementNotifications,
  trainingAudience,
  type AnnouncedLesson,
  type AudienceMember,
} from "./announce";

/**
 * Pau, 26 Nov 2026: "can you add notification to everyone when new module or
 * lesson is posted". Everyone who can open AI Training hears about a lesson the
 * first time it is published; the first lesson of a module announces the module.
 */

const users: AudienceMember[] = [
  { email: "Editor@Example.com", role: "admin", status: "active" },
  { email: "frontline@example.com", role: "employee", status: "active" },
  { email: "manager@example.com", role: "district_manager", status: "active" },
  { email: "invited@example.com", role: "employee", status: "invited" },
  { email: "gone@example.com", role: "employee", status: "disabled" },
];

const lesson = (over: Partial<AnnouncedLesson> = {}): AnnouncedLesson => ({
  id: "l1",
  title: "Claude Lesson 16: Interactive Connectors",
  summary: "Some connected apps can now open right next to your chat.",
  href: "/ai-training/claude/interactive-connectors",
  module: { id: "m5", title: "What's New in Claude", adminOnly: false },
  moduleIsNew: false,
  ...over,
});

describe("trainingAudience", () => {
  it("is every active account that may open AI Training, without the publisher", () => {
    expect(trainingAudience(users, DEFAULT_PERMISSION_MATRIX, "editor@example.com").sort()).toEqual([
      "frontline@example.com",
      "manager@example.com",
    ]);
  });

  it("follows the permission matrix in force", () => {
    const matrix = { ...DEFAULT_PERMISSION_MATRIX, employee: ["ask_questions"] } as PermissionMatrix;
    expect(trainingAudience(users, matrix, null)).not.toContain("frontline@example.com");
  });
});

describe("announcementNotifications", () => {
  const everyone = ["frontline@example.com", "manager@example.com", "other.editor@example.com"];

  it("tells everyone about a new lesson in an existing module, linking to the lesson", () => {
    const rows = announcementNotifications({ lessons: [lesson()], everyone, editors: [] });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      recipientEmail: "frontline@example.com",
      kind: NEW_LESSON_KIND,
      title: "New lesson: Claude Lesson 16: Interactive Connectors",
      body: "What's New in Claude · Some connected apps can now open right next to your chat.",
      href: "/ai-training/claude/interactive-connectors",
    });
  });

  it("announces a new module once, naming its lessons, instead of once per lesson", () => {
    const rows = announcementNotifications({
      lessons: [
        lesson({ id: "a", title: "Claude Lesson 14: Docs and Slides in Claude", href: "/ai-training/claude/docs", moduleIsNew: true }),
        lesson({ id: "b", title: "Claude Lesson 15: Whiteboards and Sheets", moduleIsNew: true }),
      ],
      everyone: ["frontline@example.com"],
      editors: [],
    });
    expect(rows).toEqual([
      {
        recipientEmail: "frontline@example.com",
        kind: NEW_MODULE_KIND,
        title: "New module: What's New in Claude",
        body: "2 lessons: Claude Lesson 14: Docs and Slides in Claude, Claude Lesson 15: Whiteboards and Sheets",
        href: "/ai-training/claude/docs",
      },
    ]);
  });

  it("keeps a lesson in an admin-only module to the other editors", () => {
    const rows = announcementNotifications({
      lessons: [lesson({ module: { id: "m9", title: "Editors only", adminOnly: true } })],
      everyone,
      editors: ["Other.Editor@example.com"],
    });
    expect(rows.map((r) => r.recipientEmail)).toEqual(["other.editor@example.com"]);
  });

  it("names AI Training when the lesson is in no module", () => {
    const [row] = announcementNotifications({ lessons: [lesson({ module: null, summary: null })], everyone, editors: [] });
    expect(row.body).toBe("AI Training");
  });
});
