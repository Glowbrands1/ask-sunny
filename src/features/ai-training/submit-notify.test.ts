import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SUBMITTING A LESSON SAVES IT, THEN RINGS THE REVIEWERS' BELL (Pau, 20 Nov
 * 2026: "make sure that submissions also saves please" and "when someone
 * submits their work, pls create a bell and notify tamsin in app").
 */

const createSubmission = vi.fn();
const createNotifications = vi.fn();
const LESSON_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async () => ({
    identity: { subject: "u-1", email: "rowan.pike@example.com", displayName: "Rowan Pike", role: "manager", scope: {}, verified: true },
  }),
}));
vi.mock("@/lib/ai-training/repository", () => ({
  getLessonById: async () => ({ id: LESSON_ID, title: "Claude Lesson 4: Build Something", status: "published" }),
  createSubmission: (...args: unknown[]) => createSubmission(...args),
}));
vi.mock("@/lib/notifications/repository", () => ({
  createNotifications: (...args: unknown[]) => createNotifications(...args),
}));

const { submitLessonResponse } = await import("./actions");

beforeEach(() => {
  vi.stubEnv("AI_TRAINING_NOTIFY_EMAILS", "reviewer.one@example.com");
  createSubmission.mockReset().mockResolvedValue(undefined);
  createNotifications.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("submitting lesson work", () => {
  it("saves the submission, then notifies the reviewer", async () => {
    const result = await submitLessonResponse({ lessonId: LESSON_ID, title: "", body: "My closing checklist", linkUrl: "" });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ lessonId: LESSON_ID, userSubject: "u-1", body: "My closing checklist", title: "Claude Lesson 4: Build Something" }),
    );
    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        recipientEmail: "reviewer.one@example.com",
        title: "Rowan Pike submitted their work",
        body: "Claude Lesson 4: Build Something",
        href: "/ai-training/manage?tab=submissions",
      }),
    ]);
    expect(createSubmission.mock.invocationCallOrder[0]).toBeLessThan(createNotifications.mock.invocationCallOrder[0]);
  });

  it("still reports the submission saved when the notification fails", async () => {
    createNotifications.mockRejectedValue(new Error("relation app_notifications does not exist"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitLessonResponse({ lessonId: LESSON_ID, title: "", body: "x", linkUrl: "" });
    expect(result.ok).toBe(true);
    expect(createSubmission).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not notify anyone when nothing was saved", async () => {
    const result = await submitLessonResponse({ lessonId: LESSON_ID, title: "", body: "", linkUrl: "" });
    expect(result).toEqual({ ok: false, message: "Write a response or add a link." });
    expect(createSubmission).not.toHaveBeenCalled();
    expect(createNotifications).not.toHaveBeenCalled();
  });
});
