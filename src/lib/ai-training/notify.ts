import { aiTrainingEditorEmails } from "./editors";
import type { NewNotification } from "@/lib/notifications/types";

/**
 * WHO HEARS ABOUT A TRAINING SUBMISSION (Pau, 20 Nov 2026: "when someone
 * submits their work, create a bell and notify Tamsin in app").
 *
 * The people are the server variable `AI_TRAINING_NOTIFY_EMAILS` (comma or
 * semicolon separated), set per deployment, like `AI_TRAINING_EDITOR_EMAILS`:
 * this repository is public, so real addresses are not written here. Unset
 * means nobody is notified. The notification links to Manage AI Training's
 * Submissions tab, which only editors can open, so each person on this list
 * should be on the editor list too.
 */
export function aiTrainingNotifyEmails(raw: string | undefined = process.env.AI_TRAINING_NOTIFY_EMAILS): string[] {
  return [...new Set(aiTrainingEditorEmails(raw))];
}

export const SUBMISSIONS_TO_REVIEW_HREF = "/ai-training/manage?tab=submissions";

/** One notification per person on the list — not to the person who submitted. */
export function submissionNotifications(input: {
  recipients: string[];
  submitterName: string;
  submitterEmail: string;
  lessonTitle: string;
}): NewNotification[] {
  const self = input.submitterEmail.trim().toLowerCase();
  const who = input.submitterName.trim() || input.submitterEmail;
  return input.recipients
    .filter((email) => email !== self)
    .map((recipientEmail) => ({
      recipientEmail,
      kind: "ai_training_submission",
      title: `${who} submitted their work`,
      body: input.lessonTitle,
      href: SUBMISSIONS_TO_REVIEW_HREF,
    }));
}
