import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatMessage } from "@/types";

import { describesIncident, describesMoreThanTheRequest } from "./corrective-action-intake";
import { parseFormDocument } from "./document";
import { isQuestion } from "./employment-change";
import { authorizeInstance } from "./instance-scope";
import { extractEmployeeNames, managerContext, samePerson } from "./proposal";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "HERE'S WHAT HAPPENED" — ON A CORRECTIVE ACTION FORM SUNNY HAD NOTHING FOR
 * ============================================================================
 *
 * A manager may create a Corrective Action Form from nothing more than "create
 * ca for Ellie Sendgraff". Sunny says up front that it cannot cite the policy
 * manual without an account of what happened, and the draft comes back blank.
 *
 * When the manager then says what happened, the form ON SCREEN is redrafted
 * from it — through the same drafting route a first draft takes, so the
 * observation, the offense box and the "Direct policy from official manual"
 * citation, section and page, are all produced exactly as they would have been
 * had the account come first. A new form is never created for it.
 *
 * WHAT THE MANAGER TYPED IN THE MEANTIME STAYS: see `keepManagerValues` on the
 * drafting route. The one exception is a policy line the redraft can cite,
 * which replaces wording typed without a section or page.
 *
 * ONLY WHERE SUNNY'S FIRST DRAFT WROTE NOTHING. A form Sunny already drafted
 * is changed by asking for the change, not by every later sentence about the
 * incident.
 */
export async function redraftActiveForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
}): Promise<AskResponse | null> {
  const question = input.question.trim();
  if (question === "" || isQuestion(question)) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { loaded } = authorized;
  const instance = loaded.instance;
  if (instance.status !== "draft") return null;

  /* A Corrective Action Form, by its shape: a cited policy line and a Type of Offense. */
  const document = parseFormDocument(loaded.version.document);
  const fields = draftableFields(document, instance.variantKey);
  const groups = draftableCheckboxGroups(document, instance.variantKey);
  if (!fields.some((field) => field.key === "policy_language")) return null;
  if (!groups.some((group) => group.key === "offense_type")) return null;

  /* Sunny's draft wrote nothing on it. */
  const sunnyWrote = loaded.values.some(
    (row) => row.filledBy === "ai" && ((row.value ?? "").trim() !== "" || row.checked.length > 0),
  );
  if (sunnyWrote) return null;

  /* About this form and this person, and an account rather than a request. */
  const intent = detectTemplateIntent(question);
  if (intent.kind === "explicit" && intent.templateKey !== instance.templateKey) return null;
  /* "On October 16th Ellie…" reads "On October" as a name; a date is not a person. */
  const named = extractEmployeeNames(question).filter((name) => !NOT_A_PERSON.test(name));
  if (named.length > 0 && !named.some((name) => samePerson(name, instance.employeeName))) return null;
  const described =
    describesIncident(question) ||
    describesMoreThanTheRequest(question, {
      ignore: [instance.employeeName, ...PRODUCTION_SALONS.map((salon) => salon.name)],
    });
  if (!described) return null;

  const notes = managerContext(input.history, { content: question }).text;

  /*
   * THE DRAFTING ROUTE ITSELF, as the manager. Same authorization, same
   * guards, same derived policy fields — nothing about the citation is
   * reimplemented here.
   */
  const headers = new Headers(input.request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const { POST } = await import("@/app/api/forms/instances/[id]/draft/route");
  const response = await POST(
    new Request(new URL(`/api/forms/instances/${input.instanceId}/draft`, input.request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ notes, keepManagerValues: true }),
    }),
    { params: Promise.resolve({ id: input.instanceId }) },
  );
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    values?: Record<string, string>;
    checked?: Record<string, string[]>;
    policyDerived?: string[];
  };

  const who = `**${instance.templateName}** for **${instance.employeeName}**`;
  if (!response.ok) {
    return reply(
      `I couldn't redraft the ${who}${result.error ? `: ${result.error}` : "."} It is as it was — you can still complete it below.`,
    );
  }

  const updated = [...Object.keys(result.values ?? {}), ...Object.keys(result.checked ?? {})];
  const cited = (result.policyDerived ?? []).includes("policy_language");
  const lines = [
    `Redrafted the ${who} from what you described.`,
    "",
    cited
      ? "**Direct policy from official manual** now quotes the manual and cites its section and page."
      : "I couldn't match what you described to a section of the policy manual, so the policy line is still yours to confirm against the official manual.",
    ...(loaded.values.some((row) => row.filledBy === "manager" && (row.value ?? "").trim() !== "")
      ? [
          "",
          cited
            ? "Anything else you had already typed on the form is kept as you wrote it."
            : "Anything you had already typed on the form is kept as you wrote it.",
        ]
      : []),
    "",
    "Give it a read below before you finalize.",
  ];

  return {
    ...reply(lines.join("\n")),
    formUpdate: { instanceId: input.instanceId, updated },
  };
}

const NOT_A_PERSON =
  /\b(?:on|at|in|by|since|before|after|last|this|next|today|yesterday|tomorrow|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
