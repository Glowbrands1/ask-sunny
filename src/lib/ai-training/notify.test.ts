import { describe, expect, it } from "vitest";

import { aiTrainingNotifyEmails, submissionNotifications, SUBMISSIONS_TO_REVIEW_HREF } from "./notify";

/**
 * Pau, 20 Nov 2026: "when someone submits their work, pls create a bell and
 * notify tamsin in app". The people are a deployment variable (the
 * repository is public), so these use invented addresses.
 */
describe("who hears about a training submission", () => {
  it("reads AI_TRAINING_NOTIFY_EMAILS, lower-cased, once each; unset is nobody", () => {
    expect(aiTrainingNotifyEmails(" Reviewer.One@Example.com; reviewer.one@example.com, two@example.com ")).toEqual([
      "reviewer.one@example.com",
      "two@example.com",
    ]);
    expect(aiTrainingNotifyEmails(undefined)).toEqual([]);
    expect(aiTrainingNotifyEmails("not-an-address")).toEqual([]);
  });

  it("writes one bell notification per reviewer, linking to the submissions to review", () => {
    const rows = submissionNotifications({
      recipients: ["reviewer.one@example.com", "two@example.com"],
      submitterName: "Rowan Pike",
      submitterEmail: "rowan.pike@example.com",
      lessonTitle: "Claude Lesson 4: Build Something You Couldn't Before",
    });
    expect(rows).toEqual([
      {
        recipientEmail: "reviewer.one@example.com",
        kind: "ai_training_submission",
        title: "Rowan Pike submitted their work",
        body: "Claude Lesson 4: Build Something You Couldn't Before",
        href: SUBMISSIONS_TO_REVIEW_HREF,
      },
      expect.objectContaining({ recipientEmail: "two@example.com" }),
    ]);
    expect(SUBMISSIONS_TO_REVIEW_HREF).toBe("/ai-training/manage?tab=submissions");
  });

  it("does not notify a reviewer about their own submission", () => {
    const rows = submissionNotifications({
      recipients: ["reviewer.one@example.com", "two@example.com"],
      submitterName: "",
      submitterEmail: "Reviewer.One@example.com",
      lessonTitle: "L",
    });
    expect(rows.map((r) => r.recipientEmail)).toEqual(["two@example.com"]);
    expect(rows[0].title).toBe("Reviewer.One@example.com submitted their work");
  });
});
