import { appConfig } from "./app-config";

import { holdsPhrase, identifiedTurns, readEvidence, verifyEvidence } from "./evidence";
import type { ToolContext, ToolResult } from "./tools";

/**
 * set_follow_up_owner (the owner, 27 Nov 2026: "assign <employee>'s follow-up to <DM>"): hand a form's follow-up to
 * someone else, or back to its creator, from the chat.
 *
 * THE SAME RULES AS THE PAGE. The manager must be allowed to edit that form (`authorizeInstance(…, "edit")`, as Form
 * Monitoring's owner control and the follow-up date are), and the person named must be one the page would offer
 * (`followUpOwnerChoices`: someone who may open and edit that form at its salon). The write is `assignFollowUpOwner`,
 * the route's own. The person is chosen from that list by the name the manager typed in THIS message (owner_evidence),
 * never from the model's own idea; a name that fits nobody, or several, writes nothing and hands back who may own it.
 */

const LISTED = 12;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Every typed word starts a word of the name ("Tobin", "tobin m", "Tobin Marsh"). */
export function nameFits(typed: string, name: string): boolean {
  const said = wordsOf(typed);
  const full = wordsOf(name);
  return said.length > 0 && said.every((word) => full.some((part) => part === word || (word.length >= 3 && part.startsWith(word))));
}

/** The forms of the reader's follow-up queue whose employee the manager named. */
async function followUpsNamed(context: ToolContext, employee: string) {
  const [{ pageFormsAccess }, { readFollowUpQueue }, { activePermissionMatrix, hasPermission }] = await Promise.all([
    import("@/lib/forms/page-scope"),
    import("@/lib/forms/follow-up-queue"),
    import("@/lib/permissions"),
  ]);
  const { actor } = context;
  const access = await pageFormsAccess({ subject: actor.subject, email: actor.email, displayName: actor.displayName, role: actor.role, scope: actor.scope, verified: actor.verified });
  const queue = await readFollowUpQueue(access, { readsExit: hasPermission(activePermissionMatrix(), actor.role, "create_exit_form"), today: context.today });
  return queue.forms.filter((form) => nameFits(employee, form.employeeName));
}

export async function setFollowUpOwnerTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const typedOwner = typeof input.owner_name === "string" ? input.owner_name.trim() : "";
  const employee = typeof input.employee_name === "string" ? input.employee_name.trim() : "";
  const instanceId = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
  const back = input.back_to_creator === true;
  if (!back && !typedOwner) return { reason_code: "missing_input", error: "Say who should own the follow-up (owner_name, as the manager typed it), or back_to_creator. Nothing was written." };
  if (!instanceId && !employee) return { reason_code: "missing_input", error: "Say whose follow-up (employee_name, as the manager typed it) or give its instance_id. Nothing was written." };

  // The owner's name must be the manager's own words in this message.
  const turns = identifiedTurns(context.history, context.question, context.questionMessageId);
  const said = verifyEvidence(input.owner_evidence, turns, { thisTurnOnly: true });
  const quote = readEvidence(input.owner_evidence)?.quote ?? "";
  if (!said.ok || (!back && !holdsPhrase(quote, typedOwner))) {
    return { reason_code: "owner_not_stated", error: "owner_evidence must be this message's words naming who should own the follow-up. Nothing was written. Ask who should do it." };
  }

  const { authorizeInstance, InstanceNotVisibleError } = await import("@/lib/forms/instance-scope");
  let formId = instanceId;
  if (!formId) {
    const named = await followUpsNamed(context, employee);
    if (named.length === 0) {
      return { reason_code: "no_follow_up", error: `No open follow-up for "${employee}" is on this manager's list. Nothing was written. Say so; read_follow_ups lists the open ones.` };
    }
    if (named.length > 1) {
      const follow_ups = named.slice(0, LISTED).map((form) => ({ instance_id: form.id, employee: form.employeeName, form: form.templateName, [appConfig().locationWord]: form.locationName, follow_up_date: form.followUpDate }));
      return { reason_code: "owner_ambiguous", error: "Several open follow-ups fit that name. Nothing was written. Ask which one.", follow_ups };
    }
    formId = named[0]!.id;
  }

  let loaded;
  try {
    ({ loaded } = await authorizeInstance(context.request, formId, "edit"));
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) return { reason_code: "form_not_visible", error: "This manager may not change that form's follow-up. Nothing was written. Say so." };
    throw error;
  }
  const form = loaded.instance;
  if (!form.followUpDate) return { reason_code: "no_follow_up", error: "That form has no follow-up date yet. Nothing was written. Ask for the date first (edit_form follow_up_date)." };

  const { accountNames, assignFollowUpOwner, followUpOwnerChoices, FollowUpOwnerError } = await import("@/lib/forms/follow-up-owner");
  const choices = await followUpOwnerChoices(form);
  let ownerId: string | null = null;
  if (!back) {
    const fits = choices.filter((choice) => nameFits(typedOwner, choice.name));
    if (fits.length === 0) {
      const may_own = choices.slice(0, LISTED).map((choice) => choice.name);
      return { reason_code: "owner_not_allowed", error: `"${typedOwner}" is not someone who may own this follow-up: only people with access to this form's ${appConfig().locationWord} and its forms may. Nothing was written. Say so and offer these.`, may_own };
    }
    if (fits.length > 1) {
      return { reason_code: "owner_ambiguous", error: `Several people fit "${typedOwner}". Nothing was written. Ask which one.`, may_own: fits.slice(0, LISTED).map((choice) => choice.name) };
    }
    ownerId = fits[0]!.id;
  }
  try {
    const { owner } = await assignFollowUpOwner(form, ownerId, context.actor.subject);
    const creator = owner ? null : (await accountNames([form.createdBy])).get(form.createdBy) ?? "the form's creator";
    return {
      updated: ["follow_up_owner"],
      follow_up: { employee: form.employeeName, form: form.templateName, follow_up_date: form.followUpDate, owner: owner ? owner.name : creator },
      note: owner
        ? `${owner.name} now owns this follow-up: it is on their Calendar with its due and overdue reminders, and the creator still sees it. Tell the manager that in one line. Claim nothing else.`
        : "The follow-up is back with the form's creator. Tell the manager in one line. Claim nothing else.",
    };
  } catch (error) {
    if (error instanceof FollowUpOwnerError) return { reason_code: error.code === "not_allowed" ? "owner_not_allowed" : "write_failed", error: `${error.message} Nothing was written.` };
    throw error;
  }
}

export function followUpOwnerToolSpec(place: string) {
  return {
    name: "set_follow_up_owner",
    description:
      "Hand a form's follow-up to someone else, or back to its creator (\"assign <employee>'s follow-up to <name>\", \"give the follow-up back to me\"). The person must have access to that form's " +
      place +
      " and its forms; the tool picks them from the people who may, by the name the manager typed, and refuses anyone else. They then see the follow-up on their Calendar with the employee's name and get its due and overdue reminders; the creator keeps seeing it. read_follow_ups and read_calendar say who owns each follow-up.",
    input_schema: {
      type: "object",
      properties: {
        employee_name: { type: "string", description: "Whose follow-up, as the manager typed it (\"Addy\"). Or give instance_id." },
        instance_id: { type: "string", description: "The form, when you have its id (find_past_forms)." },
        owner_name: { type: "string", description: "Who should own it, as the manager typed it." },
        back_to_creator: { type: "boolean", description: "True when the manager gives the follow-up back to whoever created the form." },
        owner_evidence: {
          type: "object",
          description: "This message's id and the manager's words in it naming who should own the follow-up.",
          properties: { message_id: { type: "string" }, quote: { type: "string" } },
          required: ["message_id", "quote"],
        },
      },
      required: ["owner_evidence"],
    },
  };
}
