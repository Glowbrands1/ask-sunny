# AI Training submission bell — Ask Sunny only, for now

**Change:** a bell in the top bar (`app_notifications`, migration
`20261120002000_app_notifications.sql`). When someone submits lesson work, the
people on `AI_TRAINING_NOTIFY_EMAILS` get a notification that opens Manage AI
Training → Submissions. A failed notification never fails the submission.

**Ask Bubbles:** not ported. Pau asked for it in Ask Sunny alongside the new
lesson layout (20 Nov 2026), which is also Sunny-only for now. The port is the
migration, `src/lib/notifications/`, `src/features/notifications/`,
`src/lib/ai-training/notify.ts`, the `notifyReviewers` call in
`submitLessonResponse`, the bell in `app-shell.tsx` / `(app)/layout.tsx`, and
Bubbles' own `AI_TRAINING_NOTIFY_EMAILS`. Not a bug fix: Bubbles' submissions
save as before.
