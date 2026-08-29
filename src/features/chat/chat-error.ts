import { AiError } from "@/lib/ai/errors";
import type { ChatTurnError } from "@/types";

/**
 * Turns whatever went wrong into something a salon manager can act on.
 *
 * Pure and exported so the mapping is testable without rendering anything. The
 * distinction that matters most is `retryable`: offering "Try again" on a
 * missing API key wastes the manager's time and teaches them to distrust the
 * button, so a configuration failure never offers one.
 *
 * No branch here ever falls back to answering. A failed turn stays a failed
 * turn — the alternative is a manager acting on a fabricated policy because a
 * service was down.
 */
export function toChatTurnError(error: unknown, question: string): ChatTurnError {
  if (error instanceof AiError) {
    switch (error.code) {
      case "not_configured":
        return {
          kind: "not_configured",
          message:
            error.missing.length > 0
              ? "Ask Sunny is not finished being set up, so it cannot answer yet. An administrator needs to add the missing configuration."
              : error.message,
          missing: error.missing,
          // A missing key is not fixed by asking again.
          retryable: false,
          question,
        };

      case "refused":
        return {
          kind: "model_failed",
          message: error.message,
          retryable: false,
          question,
        };

      case "retrieval_failed":
        return {
          kind: "retrieval_failed",
          message:
            "The company knowledge base could not be searched, so nothing was answered. Your question was not answered from memory.",
          retryable: true,
          question,
        };

      case "bad_request":
        // 429 arrives as bad_request from the rate limiter.
        if (error.status === 429) {
          return {
            kind: "rate_limited",
            message: error.message,
            retryable: true,
            question,
          };
        }
        return {
          kind: "bad_request",
          message: error.message,
          retryable: false,
          question,
        };

      case "model_failed":
      default:
        return {
          kind: "model_failed",
          message:
            "Sunny could not produce an answer. Nothing was answered from memory — try again in a moment.",
          retryable: true,
          question,
        };
    }
  }

  if (error instanceof Error && error.name === "AuthError") {
    return {
      kind: "unauthenticated",
      message: error.message,
      retryable: false,
      question,
    };
  }

  return {
    kind: "unknown",
    message:
      "Something went wrong and no answer was produced. Try again, and tell an administrator if it keeps happening.",
    retryable: true,
    question,
  };
}

/** Short heading for the error card. Kept out of the component for testability. */
export function chatErrorTitle(kind: ChatTurnError["kind"]): string {
  switch (kind) {
    case "not_configured":
      return "Ask Sunny is not set up yet";
    case "unauthenticated":
      return "You are not signed in";
    case "retrieval_failed":
      return "The knowledge base could not be searched";
    case "rate_limited":
      return "Too many questions at once";
    case "bad_request":
      return "That question could not be sent";
    case "model_failed":
    case "unknown":
    default:
      return "No answer was produced";
  }
}
