/** AI Training — the shapes the screens use. Rows are mapped in `repository.ts`. */

export interface TrainingTrack {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
}

export interface TrainingModule {
  id: string;
  trackId: string;
  slug: string;
  title: string;
  sortOrder: number;
  /** An archive module: administrators only. */
  adminOnly: boolean;
}

export type LessonStatus = "draft" | "published";

export interface TrainingLessonSummary {
  id: string;
  trackId: string;
  moduleId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  weekNumber: number | null;
  sortOrder: number;
  status: LessonStatus;
  publishedAt: string | null;
}

export interface TrainingLesson extends TrainingLessonSummary {
  bodyMd: string;
  updatedAt: string;
}

export interface TrainingCatalog {
  tracks: TrainingTrack[];
  modules: TrainingModule[];
  lessons: TrainingLessonSummary[];
}

export interface TrainingPage {
  key: string;
  title: string;
  bodyMd: string;
  updatedAt: string | null;
}

/** The program's own pages, keyed as the old app keyed them. */
export const TRAINING_PAGE_KEYS = ["policy", "best_practices", "announcement", "home_intro"] as const;
export type TrainingPageKey = (typeof TRAINING_PAGE_KEYS)[number];

export const TRAINING_PAGE_LABEL: Record<TrainingPageKey, string> = {
  policy: "AI Access & Use Policy",
  best_practices: "Best Practices",
  announcement: "Announcement",
  home_intro: "Welcome text",
};

export type SubmissionStatus = "pending" | "approved" | "changes_requested";

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

export interface TrainingSubmission {
  id: string;
  lessonId: string | null;
  lessonTitle: string | null;
  lessonHref: string | null;
  userName: string;
  title: string;
  body: string;
  linkUrl: string | null;
  status: SubmissionStatus;
  feedback: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
