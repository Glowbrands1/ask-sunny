import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUBLISHING A LESSON TELLS EVERYONE, ONCE (Pau, 26 Nov 2026: "can you add
 * notification to everyone when new module or lesson is posted").
 */

const LESSON_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const announceNewLessons = vi.fn();
const saveLesson = vi.fn();
const getLessonById = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async () => ({
    identity: { subject: "u-1", email: "editor@example.com", displayName: "Editor", role: "admin", scope: {}, verified: true },
  }),
}));
vi.mock("@/lib/ai-training/editors", () => ({ canEditAiTraining: () => true, aiTrainingEditorEmails: () => ["editor@example.com"] }));
vi.mock("@/lib/ai-training/sync", () => ({ publishAfterSave: async () => undefined, syncConfig: () => null }));
vi.mock("@/lib/ai-training/repository", () => ({
  getLessonById: (...args: unknown[]) => getLessonById(...args),
  saveLesson: (...args: unknown[]) => saveLesson(...args),
  saveModule: vi.fn(),
  deleteModule: vi.fn(),
}));
vi.mock("@/lib/ai-training/announce.server", () => ({
  announceNewLessons: (...args: unknown[]) => announceNewLessons(...args),
}));

const { saveLessonAction, setLessonStatusAction } = await import("./actions");

const input = (over: Record<string, unknown> = {}) => ({
  id: null,
  trackId: TRACK_ID,
  moduleId: null,
  slug: "",
  title: "Claude Lesson 16: Interactive Connectors",
  summary: "",
  bodyMd: "Hello",
  weekNumber: "",
  status: "published" as const,
  ...over,
});

beforeEach(() => {
  announceNewLessons.mockReset().mockResolvedValue(undefined);
  saveLesson.mockReset().mockResolvedValue(LESSON_ID);
  getLessonById.mockReset();
});

describe("publishing AI Training lessons", () => {
  it("tells everyone about a new lesson posted straight to published, not the editor", async () => {
    expect((await saveLessonAction(input())).ok).toBe(true);
    expect(announceNewLessons).toHaveBeenCalledWith([LESSON_ID], "editor@example.com");
    expect(saveLesson.mock.invocationCallOrder[0]).toBeLessThan(announceNewLessons.mock.invocationCallOrder[0]);
  });

  it("says nothing for a draft", async () => {
    await saveLessonAction(input({ status: "draft" }));
    expect(announceNewLessons).not.toHaveBeenCalled();
  });

  it("tells everyone when a draft is published for the first time", async () => {
    getLessonById.mockResolvedValue({ id: LESSON_ID, status: "draft", publishedAt: null });
    await saveLessonAction(input({ id: LESSON_ID }));
    await setLessonStatusAction(LESSON_ID, "published");
    expect(announceNewLessons).toHaveBeenCalledTimes(2);
  });

  it("does not tell everyone again when a published lesson is edited or republished", async () => {
    getLessonById.mockResolvedValue({ id: LESSON_ID, status: "published", publishedAt: "2026-11-20T00:00:00Z" });
    await saveLessonAction(input({ id: LESSON_ID }));
    await setLessonStatusAction(LESSON_ID, "published");
    expect(announceNewLessons).not.toHaveBeenCalled();
  });
});
