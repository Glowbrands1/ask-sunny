import {
  DEMO_ANSWERS,
  FALLBACK_ANSWER,
  type DemoAnswer,
} from "@/data/demo/chat";
import { DEMO_VIDEOS } from "@/data/demo/videos";
import { getKnowledgeProvider } from "@/lib/knowledge";
import { formatDate, isoDaysFromAnchor } from "@/lib/utils/date";
import { truncate } from "@/lib/utils/format";
import type { FormHandoff } from "@/types";
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

const FORM_INTENT = [
  "create a coaching form",
  "coaching form",
  "corrective action",
  "create a form",
  "draft a form",
  "write up",
  "write-up",
  "disciplinary",
  "dpoa",
  "policy review form",
  "performance form",
];

const TEMPLATE_INTENT: { id: string; name: string; matchers: string[] }[] = [
  {
    id: "tpl-dpoa",
    name: "Disciplinary Plan of Action (DPOA)",
    matchers: ["dpoa", "disciplinary", "corrective action", "written warning"],
  },
  {
    id: "tpl-policy-review",
    name: "Policy Review",
    matchers: ["policy review"],
  },
  {
    id: "tpl-coaching",
    name: "Coaching Form",
    matchers: ["coaching", "coach", "performance concern", "form"],
  },
];

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

function detectTemplate(question: string): { id: string; name: string } {
  const q = normalize(question);
  const match = TEMPLATE_INTENT.find((template) =>
    template.matchers.some((matcher) => q.includes(matcher)),
  );
  return match
    ? { id: match.id, name: match.name }
    : { id: "tpl-coaching", name: "Coaching Form" };
}

function extractEmployeeName(raw: string): string | null {
  const forMatch = raw.match(
    /\bfor\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/,
  );
  if (forMatch?.[1]) {
    const candidate = forMatch[1].trim();
    if (!/^(a|an|the|my|our)$/i.test(candidate)) return candidate;
  }
  const standalone = raw.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\b/);
  if (standalone?.[1] && standalone[1].length > 2) return standalone[1].trim();
  return null;
}

function extractTopic(raw: string): string | null {
  const match = raw.match(
    /\b(?:regarding|about|due to|because of|concerning|on)\s+(.{4,90})$/i,
  );
  if (match?.[1]) return match[1].replace(/[.?!]+$/, "").trim();
  return null;
}

const COACHING_TOPIC_MAP: { keywords: string[]; option: string }[] = [
  { keywords: ["tardy", "tardiness", "late", "attendance", "punctual", "call out", "no show"], option: "Attendance / punctuality" },
  { keywords: ["dress", "uniform", "badge", "footwear", "grooming"], option: "Dress code" },
  { keywords: ["sales", "conversion", "membership", "upgrade", "quota"], option: "Sales performance" },
  { keywords: ["guest", "client", "customer", "greeting", "service"], option: "Client experience" },
  { keywords: ["clean", "cleanliness", "turnover", "sanit"], option: "Cleanliness standards" },
  { keywords: ["policy", "procedure", "checklist", "closing", "opening"], option: "Policy adherence" },
  { keywords: ["team", "communication", "attitude", "conflict"], option: "Teamwork / communication" },
];

function coachingTopicOption(topic: string): string {
  const t = normalize(topic);
  const match = COACHING_TOPIC_MAP.find((entry) =>
    entry.keywords.some((keyword) => t.includes(keyword)),
  );
  return match?.option ?? "Policy adherence";
}

export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider (seeded demo responses)";
  readonly connected = false;

  async ask(request: AskRequest): Promise<AskResponse> {
    // A short, content-proportional pause so the thinking state is visible.
    await new Promise((resolve) =>
      setTimeout(resolve, 420 + Math.min(520, request.question.length * 7)),
    );

    const pending = this.findPendingFormTurn(request);
    if (pending) return this.buildFormDraft(request, pending);

    if (this.isFormIntent(request.question)) {
      return this.buildFormCollection(request);
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
   * FUTURE (ClaudeProvider): send the template's field definitions and the
   * manager's inputs to Claude as a structured tool call, and map the tool
   * result back into `values`. The guard below stays: fields whose fillRule is
   * `signature_never_ai` are never written, whatever the model returns.
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

    // Only fields the template marks as AI-populatable are written. Signature
    // fields are excluded structurally, not by convention.
    const values: Record<string, string> = {};
    request.fields.forEach((field) => {
      if (field.fillRule !== "ai_populate") return;
      if (field.type === "signature") return;
      const value = drafted[field.id];
      if (typeof value === "string" && value.length > 0) values[field.id] = value;
    });

    const checkedOptions: Record<string, string[]> = { ...input.selections };
    request.fields
      .filter(
        (field) => field.type === "checkbox_group" && field.fillRule === "ai_populate",
      )
      .forEach((field) => {
        if (checkedOptions[field.id]?.length) return;
        if (field.id === "coaching_topic" && field.options) {
          const suggestion = coachingTopicOption(topic);
          if (field.options.includes(suggestion)) {
            checkedOptions[field.id] = [suggestion];
          }
        }
        if (field.id === "coaching_type" && field.options) {
          checkedOptions[field.id] = [field.options[1] ?? field.options[0]];
        }
      });

    return { values, checkedOptions };
  }

  /* ------------------------------------------------------------- answers -- */

  private buildAnswer(request: AskRequest): AskResponse {
    const knowledge = getKnowledgeProvider();
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

  /* --------------------------------------------------------- form script -- */

  private isFormIntent(question: string): boolean {
    const q = normalize(question);
    return FORM_INTENT.some((intent) => q.includes(intent));
  }

  /** Was the previous assistant turn a "still collecting" form message? */
  private findPendingFormTurn(request: AskRequest) {
    for (let index = request.history.length - 1; index >= 0; index -= 1) {
      const message = request.history[index];
      if (message.role !== "assistant") continue;
      if (message.pendingFormTemplateId) {
        return {
          templateId: message.pendingFormTemplateId,
          values: message.pendingFormValues ?? {},
        };
      }
      return null;
    }
    return null;
  }

  private buildFormCollection(request: AskRequest): AskResponse {
    const template = detectTemplate(request.question);
    const employeeName = extractEmployeeName(request.question);
    const topic = extractTopic(request.question);

    const known: string[] = [];
    const missing: string[] = [];

    if (employeeName) known.push(`**Employee** — ${employeeName}`);
    else missing.push("the team member's name");

    if (topic) known.push(`**Topic** — ${topic}`);
    else missing.push("what the conversation is about");

    known.push(`**Location** — ${request.context.locationName}`);
    known.push(`**Manager** — ${request.context.userName}`);
    known.push(`**Form date** — today`);

    missing.push("the specific dates and what was observed");
    missing.push("the expected behaviour going forward");
    missing.push("the follow-up date");

    const content = `I can draft a **${template.name}** for you.

Here is what I already have:

${known.map((entry) => `- ${entry}`).join("\n")}

To finish the draft I still need ${missing.length} things:

${missing.map((entry, index) => `${index + 1}. ${missing.length > 1 ? "" : ""}${entry.charAt(0).toUpperCase()}${entry.slice(1)}`).join("\n")}

Tell me in your own words and I will write the draft — you can edit every field before you save it.`;

    return {
      content,
      citations: [],
      recommendedVideoIds: ["vid-04"],
      pendingFormTemplateId: template.id,
      pendingFormValues: {
        employee_name: employeeName ?? "",
        topic: topic ?? "",
        location: request.context.locationName,
        manager: request.context.userName,
        form_date: request.context.todayIso,
      },
      followUpSuggestions: employeeName
        ? [
            `Late on the 12th, 15th and 19th — between 10 and 20 minutes each time. Expect ${employeeName} ready at scheduled start. Follow up in 14 days.`,
            "Use today's date and a 14-day follow-up",
          ]
        : [
            "Jane Kowalski — late on the 12th, 15th and 19th, between 10 and 20 minutes each time. Follow up in 14 days.",
            "Use today's date and a 14-day follow-up",
          ],
    };
  }

  private buildFormDraft(
    request: AskRequest,
    pending: { templateId: string; values: Record<string, string> },
  ): AskResponse {
    const reply = request.question.trim();
    const employeeName =
      pending.values.employee_name || extractEmployeeName(reply) || "Jane Kowalski";
    const topicRaw =
      pending.values.topic || extractTopic(reply) || "repeated tardiness";
    const topic = topicRaw.charAt(0).toUpperCase() + topicRaw.slice(1);

    const detailsFromReply =
      reply.length > 40
        ? reply
        : `Arrived after the start of a scheduled shift on three occasions in the past two weeks, between ten and twenty minutes late each time. Each instance was noted on the day it occurred.`;

    const followUpDate = isoDaysFromAnchor(14);

    const values: Record<string, string> = {
      employee_name: employeeName,
      employee_role: "Tanning Consultant",
      location: pending.values.location || request.context.locationName,
      form_date: pending.values.form_date || request.context.todayIso,
      manager: pending.values.manager || request.context.userName,
      topic,
      details: detailsFromReply,
      expected_action: `Meet the expected standard for ${topicRaw.toLowerCase()} on every scheduled shift, beginning immediately. We will review progress together on the follow-up date.`,
      support_offered: "",
      follow_up_date: followUpDate,
    };

    const checkedOptions: Record<string, string[]> = {
      coaching_type: ["Documented coaching"],
      coaching_topic: [coachingTopicOption(topicRaw)],
    };

    const templateName =
      pending.templateId === "tpl-dpoa"
        ? "Disciplinary Plan of Action (DPOA)"
        : pending.templateId === "tpl-policy-review"
          ? "Policy Review"
          : "Coaching Form";

    const handoff: FormHandoff = {
      templateId: pending.templateId,
      templateName,
      values,
      checkedOptions,
    };

    const content = `Here is the draft **${templateName}** for **${employeeName}**.

- **Topic** — ${topic}
- **Location** — ${values.location}
- **Manager** — ${values.manager}
- **Follow-up** — ${formatDate(followUpDate)}

**Details of the conversation**

${values.details}

**Expected action going forward**

${values.expected_action}

Open it in Create a Form to edit any field directly before you save — every line above is editable, including the ones I drafted.

Before the conversation, read the exact policy language from the official manual. Signature lines stay blank until they are signed in person.`;

    return {
      content,
      citations: getKnowledgeProvider().citationsForChunkIds([
        "chunk-004",
        "chunk-005",
        "chunk-001",
      ]),
      recommendedVideoIds: ["vid-04", "vid-05"],
      formHandoff: handoff,
      followUpSuggestions: [
        "Make the expected action more specific",
        "What should I document afterwards?",
      ],
    };
  }
}
