import { NextResponse } from "next/server";

import { answerQuestion } from "@/lib/ai/server-ask";
import { AiError } from "@/lib/ai/errors";
import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import type { AskRequest } from "@/lib/ai/types";
import type { AnswerMode, ChatMessage } from "@/types";

/**
 * POST /api/chat
 *
 * The only place Claude is ever called. The browser sends a question; this
 * handler retrieves company knowledge, builds the grounding context, calls
 * Claude and maps the result back to an AskResponse with real citations.
 *
 * ANTHROPIC_API_KEY and VOYAGE_API_KEY are read here, on the server, and never
 * cross the boundary in either direction.
 *
 * SECURITY NOTE (not yet closed): this route has no authentication. Production
 * authentication is a separate milestone; until it lands, this endpoint must
 * not be exposed on a public deployment with a live knowledge base behind it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: AnswerMode[] = ["quick", "standard", "detailed"];

export async function POST(request: Request) {
  try {
    assertLiveMode();

    const body = (await request.json().catch(() => null)) as Partial<AskRequest> | null;
    if (!body) {
      throw new AiError("bad_request", "The request body could not be read.", 400);
    }

    const parsed = parseAskRequest(body);
    const answer = await answerQuestion(parsed);

    return NextResponse.json(answer);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Validates and bounds everything that arrived from the browser. */
function parseAskRequest(body: Partial<AskRequest>): AskRequest {
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    throw new AiError("bad_request", "A question is required.", 400);
  }
  if (question.length > 4000) {
    throw new AiError("bad_request", "That question is too long. Shorten it and try again.", 400);
  }

  const scopeId = typeof body.scopeId === "string" ? body.scopeId.trim() : "";
  if (!scopeId || !/^[a-z0-9-]{1,64}$/i.test(scopeId)) {
    throw new AiError("bad_request", "A valid knowledge scope is required.", 400);
  }

  const mode: AnswerMode = MODES.includes(body.mode as AnswerMode)
    ? (body.mode as AnswerMode)
    : "standard";

  const history: ChatMessage[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (message): message is ChatMessage =>
            Boolean(message) &&
            typeof message.content === "string" &&
            (message.role === "user" || message.role === "assistant"),
        )
        .slice(-20)
    : [];

  const context = body.context ?? {
    userName: "Manager",
    locationName: "your salon",
    todayIso: new Date().toISOString().slice(0, 10),
  };

  return {
    question,
    mode,
    history,
    scopeId,
    attachedDocumentIds: Array.isArray(body.attachedDocumentIds)
      ? body.attachedDocumentIds.slice(0, 20)
      : undefined,
    context: {
      userName: String(context.userName ?? "Manager").slice(0, 120),
      locationName: String(context.locationName ?? "your salon").slice(0, 120),
      todayIso: String(context.todayIso ?? "").slice(0, 10),
    },
  };
}
