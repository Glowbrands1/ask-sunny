import "server-only";

import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import { configurationProblems, MissingConfigurationError } from "@/lib/config/server-env";
import { IngestionError } from "@/lib/ingestion/errors";
import { EmbeddingError } from "@/lib/embeddings/types";

/**
 * One error-to-response mapping for every route.
 *
 * LOGGING POLICY, enforced here rather than left to each handler:
 *   - never log a question, an answer, a grounding prompt or document text,
 *   - never log an API key or any environment VALUE,
 *   - log the error class and message only, which are written to be user-safe.
 *
 * Anything unrecognised becomes a generic 500. An unexpected error's message
 * can carry request content, so it is not echoed to the client.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, missing: error.missing },
      { status: error.status },
    );
  }

  if (error instanceof MissingConfigurationError) {
    return NextResponse.json(
      { error: error.message, code: "not_configured", missing: error.missing },
      { status: 503 },
    );
  }

  if (error instanceof IngestionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof EmbeddingError) {
    return NextResponse.json(
      { error: error.message, code: "embedding_failed" },
      { status: error.status },
    );
  }

  console.error(
    "[ask-sunny] unhandled route error:",
    error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
  );

  return NextResponse.json(
    { error: "Something went wrong. Nothing was answered or saved.", code: "internal" },
    { status: 500 },
  );
}

/**
 * Refuses to serve a request while a configuration problem stands.
 *
 * These are worse than a missing variable: the app would start and behave
 * strangely rather than obviously fail. Checked per request so a fix takes
 * effect on redeploy without a code change.
 */
export function assertNoConfigurationProblems(): void {
  const problems = configurationProblems();
  if (problems.length > 0) {
    throw new AiError("not_configured", problems.join(" "), 503);
  }
}

/**
 * Guard every live route runs first. Demo mode has no server dependencies, so a
 * live route firing while the app is in demo mode is a configuration mistake
 * worth naming rather than a request to serve a mock.
 */
export function assertLiveMode(): void {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
    throw new AiError(
      "not_configured",
      "Ask Sunny is running in demo mode. Set NEXT_PUBLIC_DEMO_MODE=false and configure the live services to use this endpoint.",
      409,
    );
  }
}
