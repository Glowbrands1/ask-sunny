import type { IntakeItem } from "@/lib/forms/corrective-action-intake";

import {
  confirmedFromToolTurn,
  EMPTY_CONFIRMED_FIELDS,
  missingIntakeItems,
  questionWithConfirmedFields,
  retainFieldsInReply,
  retentionReply,
  type ConfirmedFormFields,
} from "./form-field-state";
import type { FormToolTurn } from "./form-tool-schema";
import type { AskResponse } from "./types";

/**
 * A tool reading that belongs on the form path, not in knowledge search.
 * A policy question stays on search even when a form is open.
 */
export function formCommandBypassesSearch(reading: FormToolTurn): boolean {
  return reading.intent !== "policy_question" && reading.intent !== "other";
}

const KNOWN_TEMPLATE_KEYS = new Set(["dpoa", "coaching", "stc-exit"]);

export function templateKeyFor(reading: FormToolTurn, openTemplateKey: string | null | undefined): string | null {
  if (reading.templateKey && KNOWN_TEMPLATE_KEYS.has(reading.templateKey)) return reading.templateKey;
  if (openTemplateKey && openTemplateKey.trim() !== "") return openTemplateKey.trim();
  return null;
}

export interface UnderstoodFormRoute {
  readonly response: AskResponse;
  readonly fields: ConfirmedFormFields;
  readonly missing: readonly IntakeItem[];
}

/**
 * Hand a corroborated restatement to the existing proposal, then drop any
 * repeated asks. When the proposal stands down, the reply lists only what is
 * still missing and does not say nothing was created.
 */
export async function routeUnderstoodFormTurn(input: {
  readonly reading: FormToolTurn;
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly today: string;
  readonly openTemplateKey?: string | null;
  readonly previous?: ConfirmedFormFields;
  readonly propose: (adjusted: {
    readonly question: string;
    readonly continueTemplateKey: string;
  }) => Promise<AskResponse | null>;
}): Promise<UnderstoodFormRoute | null> {
  if (!formCommandBypassesSearch(input.reading)) return null;

  const managerText = [
    ...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    input.question,
  ].join("\n");
  const fields = confirmedFromToolTurn(
    input.previous ?? EMPTY_CONFIRMED_FIELDS,
    input.reading,
    managerText,
    input.today,
  );
  const missing = missingIntakeItems(managerText, fields);
  const templateKey = templateKeyFor(input.reading, input.openTemplateKey);

  if (templateKey) {
    const proposal = await input.propose({
      question: questionWithConfirmedFields(input.question, fields),
      continueTemplateKey: templateKey,
    });
    if (proposal) {
      return {
        fields,
        missing,
        response: {
          ...proposal,
          content: retainFieldsInReply(proposal.content, fields),
          coverage: proposal.coverage ?? "not_applicable",
        },
      };
    }
  }

  return {
    fields,
    missing,
    response: {
      content: retentionReply(fields, missing),
      citations: [],
      coverage: "not_applicable",
      recommendedVideoIds: [],
    },
  };
}
