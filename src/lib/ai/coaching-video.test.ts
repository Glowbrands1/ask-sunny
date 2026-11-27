import { describe, expect, it } from "vitest";

import type { TrainingVideo } from "@/lib/videos/types";

import { closestCoachingVideo, withCoachingVideo } from "./coaching-video";

/* The owner, 26 Nov 2026: link the closest related training video under a coaching answer, or none; never make one up. */

function video(id: string, title: string, keywords: string[], status: TrainingVideo["status"] = "ready"): TrainingVideo {
  return {
    id, title, description: "", category: "coaching", durationSeconds: 60, uploadedByName: "Training Team", uploadedAt: "2026-11-01T00:00:00Z",
    equipment: [], keywords, tags: [], status, hasCloudAsset: true, mimeType: "video/mp4", sizeBytes: 1, transcriptStatus: "none" as TrainingVideo["transcriptStatus"],
    transcriptText: null, transcriptErrorSafe: null, transcriptProvider: null, viewCount: 0, thumbnailTone: "sage",
  };
}

const PUNCTUAL = video("vid-punctual", "Coaching a team member on punctuality", ["late", "lateness", "attendance"]);
const BEDS = video("vid-beds", "Cleaning a bed between guests", ["cleaning", "beds"]);
const UPSELL = video("vid-upsell", "Offering the upgrade", ["upselling", "upgrade", "sales"]);

describe("closestCoachingVideo", () => {
  it("picks the video on the question's topic", () => {
    expect(closestCoachingVideo("how do I coach someone who keeps showing up late", [BEDS, PUNCTUAL, UPSELL])).toBe("vid-punctual");
    expect(closestCoachingVideo("how do I help an employee who is struggling with upselling", [BEDS, PUNCTUAL, UPSELL])).toBe("vid-upsell");
  });

  it("names none when no video shares a topic word, and never a video that is not ready", () => {
    expect(closestCoachingVideo("tips for a hard conversation with a leader about follow-ups", [BEDS])).toBeNull();
    expect(closestCoachingVideo("how do I coach someone who keeps showing up late", [video("p", "Punctuality", ["late"], "pending_upload")])).toBeNull();
    expect(closestCoachingVideo("how do I coach someone", [PUNCTUAL])).toBeNull();
  });
});

describe("withCoachingVideo", () => {
  const library = async () => [BEDS, PUNCTUAL];
  const answer = { content: "…", recommendedVideoIds: [] as string[] };

  it("adds the closest video to a coaching how-to answer for a role that may view videos", async () => {
    const out = await withCoachingVideo(answer, { question: "how do I coach someone who keeps showing up late", role: "salon_director" }, library);
    expect(out.recommendedVideoIds).toEqual(["vid-punctual"]);
  });

  it("leaves a policy lookup, a card turn and a failed library read alone", async () => {
    expect((await withCoachingVideo(answer, { question: "what's the attendance policy?", role: "salon_director" }, library)).recommendedVideoIds).toEqual([]);
    expect((await withCoachingVideo({ ...answer, formProposal: {} }, { question: "how do I coach someone who keeps showing up late", role: "salon_director" }, library)).recommendedVideoIds).toEqual([]);
    expect((await withCoachingVideo(answer, { question: "how do I coach someone who keeps showing up late", role: "salon_director" }, async () => { throw new Error("down"); })).recommendedVideoIds).toEqual([]);
  });
});
