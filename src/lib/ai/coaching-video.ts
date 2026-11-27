import { adviceNotForm } from "@/lib/ai/agent-loop/advice-not-form";
import { activePermissionMatrix, hasPermission } from "@/lib/permissions";
import type { TrainingVideo } from "@/lib/videos/types";
import type { Role } from "@/types";

import { asksCoachingHowTo } from "./coaching-how-to";

/*
 * ============================================================================
 * A COACHING ANSWER LINKS THE CLOSEST TRAINING VIDEO, OR NONE (the owner, 26 Nov 2026)
 * ============================================================================
 *
 * From a sibling product's coaching answers: the closest related training video is attached under the answer. The chat
 * already shows a video named in an answer's recommendedVideoIds (`features/chat/message-bubble.tsx`); the live paths
 * always sent none. Now a coaching how-to answer (`adviceNotForm` + `asksCoachingHowTo`, the same reading the loop's
 * prep-package check uses) names the one ready video in the Videos library whose title, description, keywords, tags or
 * category share a topic word with the manager's question. Nothing shares one: no video. A video is never made up: only
 * an id read from the library is named. Only for a viewer who may view videos (`view_videos`, the Videos page's own
 * permission), and never on a turn that made a card.
 */

/** Words every coaching question has, which say nothing about its topic. */
const GENERIC = new Set(
  [
    "coach", "coaching", "someone", "somebody", "employee", "employees", "team", "member", "members", "leader", "leaders",
    "manager", "managers", "staff", "people", "person", "about", "with", "what", "when", "where", "which", "that", "this",
    "they", "them", "their", "there", "have", "keep", "keeps", "show", "showing", "give", "tips", "tip", "advice", "help",
    "script", "talk", "talking", "conversation", "conversations", "hard", "tough", "difficult", "should", "would", "could",
    "does", "doing", "make", "from", "your", "more", "better", "good", "best", "guest", "guests", "between", "work", "running",
    "handle", "deal", "need", "want", "please", "like", "into", "over", "really", "just", "some", "very", "always", "never",
  ].map(stem),
);

function stem(word: string): string {
  for (const suffix of ["ness", "ing", "ed", "es", "s", "ly"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

function topicWords(text: string): Set<string> {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3)
      .map(stem)
      .filter((word) => !GENERIC.has(word)),
  );
}

/** The ready video sharing the most topic words with the question (the newest on a tie, as the library is ordered), or null. */
export function closestCoachingVideo(question: string, library: readonly TrainingVideo[]): string | null {
  const asked = topicWords(question);
  if (asked.size === 0) return null;
  let best: { id: string; hits: number } | null = null;
  for (const video of library) {
    if (video.status !== "ready") continue;
    const words = topicWords([video.title, video.description, video.category, ...video.keywords, ...video.tags].join(" "));
    const hits = [...asked].filter((word) => words.has(word)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { id: video.id, hits };
  }
  return best?.id ?? null;
}

type Turn = { readonly role: string; readonly content: unknown };

/** An answer with the closest video named, when the turn is a coaching how-to and the viewer may view videos. */
export async function withCoachingVideo<T extends { recommendedVideoIds?: string[]; formProposal?: unknown }>(
  answer: T,
  input: { readonly question: string; readonly history?: readonly Turn[]; readonly role: Role },
  library: () => Promise<readonly TrainingVideo[]> = async () => (await import("@/lib/videos/repository")).listTrainingVideos(["ready"]),
): Promise<T> {
  if (answer.formProposal || (answer.recommendedVideoIds?.length ?? 0) > 0) return answer;
  if (!adviceNotForm(input.question, input.history ?? []) || !asksCoachingHowTo(input.question)) return answer;
  if (!hasPermission(activePermissionMatrix(), input.role, "view_videos")) return answer;
  /* The library is a nice-to-have under the answer: a failed read never costs the manager the answer. */
  const videos = await library().catch(() => [] as readonly TrainingVideo[]);
  const id = closestCoachingVideo(input.question, videos);
  return id ? { ...answer, recommendedVideoIds: [id] } : answer;
}
