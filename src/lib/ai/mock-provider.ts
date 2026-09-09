import {
  DEMO_ANSWERS,
  FALLBACK_ANSWER,
  type DemoAnswer,
} from "@/data/demo/chat";
import { DEMO_VIDEOS } from "@/data/demo/videos";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { getLocalKnowledgeProvider } from "@/lib/knowledge";
import { truncate } from "@/lib/utils/format";
import type { AIProvider, ClientAskRequest, AskResponse } from "./types";

/**
 * MockAIProvider — the provider used whenever ANTHROPIC_API_KEY is absent.
 *
 * It does three things:
 *   1. Matches a question against the seeded answer bank and returns the
 *      response for the active answer mode, with real SourceCitation objects.
 *   2. Recommends videos by matching the question against each video's
 *      equipment / keywords / tags / category — the same fields production will
 *      match on.
 *   3. Recognises a form request and declines it honestly — see `ask` below.
 *
 * It never calls a network service and never reads an API key.
 */

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function scoreAnswer(answer: DemoAnswer, question: string): number {
  const q = normalize(question);
  let score = 0;
  answer.matchers.forEach((matcher) => {
    if (q.includes(matcher)) {
      score += matcher.split(" ").length * 2 + matcher.length / 10;
    }
  });
  return score;
}

function matchVideos(question: string, preferred: string[]): string[] {
  if (preferred.length) return preferred.slice(0, 3);
  const q = normalize(question);
  const scored = DEMO_VIDEOS.map((video) => {
    const haystack = [
      ...video.keywords,
      ...video.tags,
      ...video.equipment,
      video.category,
      video.title,
    ]
      .join(" ")
      .toLowerCase();
    const hits = haystack
      .split(/[\s,]+/)
      .filter((token) => token.length > 3 && q.includes(token)).length;
    return { id: video.id, hits };
  })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 2).map((entry) => entry.id);
}

export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider (seeded demo responses)";
  readonly connected = false;

  async ask(request: ClientAskRequest): Promise<AskResponse> {
    // A short, content-proportional pause so the thinking state is visible.
    await new Promise((resolve) =>
      setTimeout(resolve, 420 + Math.min(520, request.question.length * 7)),
    );

    /*
     * ======================================================================
     * PREVIEW MODE DOES NOT PROPOSE FORMS, AND SAYS SO
     * ======================================================================
     *
     * This branch used to run the whole scripted chat-to-form flow: it
     * collected what was missing, then drafted a Coaching Form with the
     * employee defaulted to "Jane Kowalski", the reason to repeated tardiness,
     * the job title to "Tanning Consultant" and the follow-up to today plus
     * fourteen days — and offered it as a chip the manager could click.
     *
     * A REAL PROPOSAL NEEDS TWO THINGS THIS PROVIDER CANNOT HAVE: the published
     * template library, which lives behind the privileged key on the server,
     * and a verified scope saying which salons the person covers. Preview mode
     * has neither. Producing a convincing coaching document from neither is
     * exactly the behaviour Phase 2 exists to remove, so the honest answer is
     * to name the limitation.
     *
     * The SENTENCE is still read the same way the server reads it —
     * `detectTemplateIntent` is the one shared implementation — so preview and
     * live agree on what counts as a form request.
     */
    if (detectTemplateIntent(request.question).kind !== "none") {
      return {
        content: [
          "I can't propose a form in preview mode.",
          "",
          "Proposing one means checking which forms are actually published and which salon you're assigned to, and preview mode can't verify either — so anything I filled in would be made up. You can still open **Create a Form** and fill one in yourself.",
        ].join("\n"),
        citations: [],
        coverage: "not_applicable",
        recommendedVideoIds: [],
      };
    }

    return this.buildAnswer(request);
  }

  titleForConversation(firstMessage: string): string {
    const cleaned = firstMessage.replace(/\s+/g, " ").trim();
    if (!cleaned) return "New conversation";
    return truncate(cleaned.replace(/[?.!]+$/, ""), 46);
  }

  /* ------------------------------------------------------------- answers -- */

  private buildAnswer(request: ClientAskRequest): AskResponse {
    const knowledge = getLocalKnowledgeProvider();
    const ranked = DEMO_ANSWERS.map((answer) => ({
      answer,
      score: scoreAnswer(answer, request.question),
    }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.answer;

    if (!best) {
      return {
        content: FALLBACK_ANSWER[request.mode],
        citations: [],
        // Nothing in the seeded corpus matched, which is the demo's version of
        // the same honest state live mode reports.
        coverage: "insufficient",
        recommendedVideoIds: matchVideos(request.question, []),
        followUpSuggestions: [
          "What should I focus on in today's Daily Stats?",
          "Help me prepare for a coaching conversation.",
        ],
      };
    }

    const citations =
      request.mode === "quick"
        ? knowledge.citationsForChunkIds(best.citationChunkIds.slice(0, 1))
        : knowledge.citationsForChunkIds(best.citationChunkIds);

    const videos =
      request.mode === "quick"
        ? best.videoIds.slice(0, 1)
        : matchVideos(request.question, best.videoIds);

    return {
      content: best[request.mode],
      citations,
      coverage: citations.length > 0 ? "grounded" : "insufficient",
      recommendedVideoIds: videos,
      followUpSuggestions: best.followUps,
    };
  }
}
