import {
  DEMO_ANSWERS,
  FALLBACK_ANSWER,
  type DemoAnswer,
} from "@/data/demo/chat";
import { DEMO_VIDEOS } from "@/data/demo/videos";
import {
  applyFillRules,
  buildFormCollection,
  buildFormDraft,
  fillCheckboxDefaults,
  findPendingFormTurn,
  isFormIntent,
} from "@/lib/forms/chat-flow";
import { getLocalKnowledgeProvider } from "@/lib/knowledge";
import { truncate } from "@/lib/utils/format";
import type {
  AIProvider,
  AskRequest,
  AskResponse,
  FormDraftRequest,
  FormDraftResponse,
} from "./types";

/**
 * MockAIProvider — the provider used whenever ANTHROPIC_API_KEY is absent.
 *
 * It does three things:
 *   1. Matches a question against the seeded answer bank and returns the
 *      response for the active answer mode, with real SourceCitation objects.
 *   2. Recommends videos by matching the question against each video's
 *      equipment / keywords / tags / category — the same fields production will
 *      match on.
 *   3. Runs the scripted chat-to-form flow: collect what is missing, then hand
 *      a pre-filled draft to the Create a Form workspace.
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

  async ask(request: AskRequest): Promise<AskResponse> {
    // A short, content-proportional pause so the thinking state is visible.
    await new Promise((resolve) =>
      setTimeout(resolve, 420 + Math.min(520, request.question.length * 7)),
    );

    const pending = findPendingFormTurn(request.history);
    if (pending) {
      return buildFormDraft({
        reply: request.question,
        pending,
        context: request.context,
        citations: getLocalKnowledgeProvider().citationsForChunkIds([
          "chunk-004",
          "chunk-005",
          "chunk-001",
        ]),
      });
    }

    if (isFormIntent(request.question)) {
      return buildFormCollection(request.question, request.context);
    }

    return this.buildAnswer(request);
  }

  titleForConversation(firstMessage: string): string {
    const cleaned = firstMessage.replace(/\s+/g, " ").trim();
    if (!cleaned) return "New conversation";
    return truncate(cleaned.replace(/[?.!]+$/, ""), 46);
  }

  /**
   * Drafts the AI-populated fields of a form.
   *
   * The fillRule guard lives in `lib/forms/chat-flow.ts` and is shared with
   * ClaudeProvider, so a signature field stays blank whichever provider ran.
   */
  async draftForm(request: FormDraftRequest): Promise<FormDraftResponse> {
    await new Promise((resolve) => setTimeout(resolve, 900));

    const { input } = request;
    const topic = input.topic.trim() || "performance expectations";
    const lowerTopic = topic.charAt(0).toLowerCase() + topic.slice(1);

    const details =
      input.incidentDetails.trim() ||
      `Discussed ${lowerTopic} with ${input.employeeName || "the team member"} at ${input.locationName}. Specific dates and observed behaviour to be confirmed by the manager before this form is signed.`;

    const drafted: Record<string, string> = {
      employee_name: input.employeeName,
      employee_role: input.employeeRole,
      location: input.locationName,
      manager: input.managerName,
      form_date: input.formDate,
      topic: topic.charAt(0).toUpperCase() + topic.slice(1),
      details,
      expected_action: `Meet the expected standard for ${lowerTopic} on every scheduled shift, beginning immediately. Progress will be reviewed together on the follow-up date, and continued shortfall moves to the next step in the coaching sequence.`,
      policy_name: topic.charAt(0).toUpperCase() + topic.slice(1),
      plan_period: "30 days",
      follow_up_date: input.followUpDate,
    };

    return {
      values: applyFillRules(request.fields, drafted),
      checkedOptions: fillCheckboxDefaults(request, input.selections, topic),
    };
  }

  /* ------------------------------------------------------------- answers -- */

  private buildAnswer(request: AskRequest): AskResponse {
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
      recommendedVideoIds: videos,
      followUpSuggestions: best.followUps,
    };
  }
}
