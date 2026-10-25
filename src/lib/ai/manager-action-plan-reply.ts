import { actionPlanManagerOnlyEnabled } from "@/lib/config/chat-quality-flags";
import { replyWithManagerActionPlan } from "@/lib/forms/manager-action-plan";

import type { AskRequest, AskResponse } from "./types";

/**
 * The last step of a Corrective Action card: the Action Plan on it is the one
 * the manager typed, word for word, or there is none. Runs after every other
 * step, the reply check included, so no path can put the standard sentences
 * back. Off, or on any other turn, the response is returned as it came.
 */
export function keepManagerActionPlan(
  response: AskResponse,
  request: Pick<AskRequest, "history" | "question">,
): AskResponse {
  if (!actionPlanManagerOnlyEnabled() || response.formProposal?.templateKey !== "dpoa") return response;
  const turns = [
    ...request.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    request.question,
  ];
  const content = replyWithManagerActionPlan(response.content, turns, "Action Plan");
  return content === response.content ? response : { ...response, content };
}
