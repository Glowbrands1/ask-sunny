import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING ANSWER LINKS THE CLOSEST TRAINING VIDEO, OR NONE (the owner, 26 Nov 2026)
 * ============================================================================
 *
 * The owner, from a sibling product: the closest related training video is attached to coaching answers. When the
 * Videos library has a ready video on the topic, the answer's recommendedVideoIds names it (the chat already shows a
 * named video under the answer); when nothing matches, none is named, and a video is never made up
 * (`src/lib/ai/coaching-video.ts`). Only for a manager who may view videos.
 */

const LOOP = "AGENT_LOOP_ENABLED";
const REPORT = "The owner, 26 Nov 2026: attach the closest related training video to coaching answers, or none";
const ANSWER = "1. Opening\n2. Facts\n3. Listen\n4. Next steps\n5. Follow-up\n\n\"I want to talk about being on time, because the team counts on you and I want to help.\"\n\nRole-play it once; action plan: on time five shifts in a row, follow-up next week.";

function video(id: string, title: string, keywords: string[], status = "ready") {
  return {
    id, title, description: `${title}.`, category: "coaching", duration_seconds: 120, uploaded_by_name: "Training Team",
    uploaded_at: "2026-11-01T12:00:00Z", equipment: [], keywords, tags: [], storage_bucket: "training-videos",
    storage_path: `${id}.mp4`, mime_type: "video/mp4", size_bytes: 1000, status, transcript_status: "none",
    transcript_text: null, transcript_error_safe: null, transcript_provider: null, view_count: 0, thumbnail_tone: "sage",
  };
}

const PUNCTUAL = video("vid-punctual", "Coaching a team member on punctuality", ["late", "lateness", "attendance", "punctuality", "tardy"]);
const BEDS = video("vid-beds", "Cleaning a bed between guests", ["cleaning", "sanitizing", "beds"]);

function start(t: ReplayContext, rows: Record<string, unknown>[]) {
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.addRows!("training_videos", rows);
  t.loopModel!(loopStandIn((): LoopDecision => ({ text: ANSWER })));
}

const videosOf = (reply: unknown) => (reply as { recommendedVideoIds?: string[] }).recommendedVideoIds ?? [];

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [LOOP],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV26_COACHING_VIDEO_CASES: ReplayCase[] = [
  loopCase("nov26-coaching-video-closest", "\"how do I coach someone who keeps showing up late\": the punctuality video is linked under the answer, never the bed-cleaning one", async (t) => {
    start(t, [BEDS, PUNCTUAL]);
    const reply = await t.thread().say("how do I coach someone who keeps showing up late");
    expect(videosOf(reply)).toEqual(["vid-punctual"]);
  }),
  loopCase("nov26-coaching-video-none-matches", "\"tips for a hard conversation with a leader about follow-ups\" with no video on the topic: no video is linked", async (t) => {
    start(t, [BEDS]);
    const reply = await t.thread().say("tips for a hard conversation with a leader about follow-ups");
    expect(videosOf(reply)).toEqual([]);
  }),
  loopCase("nov26-coaching-video-ready-only", "A punctuality video still uploading is never linked", async (t) => {
    start(t, [video("vid-pending", "Coaching a team member on punctuality", ["late", "punctuality"], "pending_upload")]);
    const reply = await t.thread().say("how do I coach someone who keeps showing up late");
    expect(videosOf(reply)).toEqual([]);
  }),
  loopCase("nov26-coaching-video-not-for-policy-lookups", "Control: a policy lookup (\"what's the attendance policy?\") gets no video", async (t) => {
    start(t, [PUNCTUAL]);
    const reply = await t.thread().say("what's the attendance policy?");
    expect(videosOf(reply)).toEqual([]);
  }),
];
