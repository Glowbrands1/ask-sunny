/**
 * Notes a manager asked Sunny to keep, and the block added to the prompt.
 *
 * Off, nothing calls this. A recalled note does not change salon scope.
 */

export interface MemoryFact {
  readonly kind: "salon" | "employee" | "preference";
  readonly key: string;
  readonly value: string;
  readonly sourceConversationId?: string | null;
}

export interface MemoryCue {
  readonly kind: MemoryFact["kind"];
  readonly key: string;
  readonly value: string;
}

export function memoryCue(question: string): MemoryCue | null {
  const text = (question ?? "").trim();
  const remember = /^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i.exec(text);
  if (!remember) return null;
  const rest = remember[1]!.trim().replace(/[.]+$/, "");
  const salon = /^(?:my )?(?:default )?salon is\s+(.+)$/i.exec(rest);
  if (salon) return { kind: "salon", key: "default", value: salon[1]!.trim().slice(0, 120) };
  const employee = /^(.+?)\s+is (?:an?|the)\s+(.+?)(?:\s+at\s+(.+))?$/i.exec(rest);
  if (employee && /salon|director|consultant|manager/i.test(employee[2] ?? "")) {
    const where = employee[3] ? ` at ${employee[3].trim()}` : "";
    return {
      kind: "employee",
      key: employee[1]!.trim().toLowerCase().slice(0, 80),
      value: `${employee[1]!.trim()}, ${employee[2]!.trim()}${where}`.slice(0, 200),
    };
  }
  return { kind: "preference", key: "note", value: rest.slice(0, 240) };
}

/**
 * Salon notes may follow the user. An employee or a preference is shown
 * only in the conversation that stored it. No conversation id hides those.
 */
export function factsVisibleInConversation(
  facts: readonly MemoryFact[],
  conversationId: string | null,
): MemoryFact[] {
  return facts.filter((fact) => {
    if (fact.kind === "salon") return true;
    return Boolean(conversationId) && fact.sourceConversationId === conversationId;
  });
}

export function formatRecalledMemory(facts: readonly MemoryFact[]): string | null {
  if (facts.length === 0) return null;
  const lines = facts.slice(0, 12).map((fact) => `- ${fact.kind}: ${fact.value}`);
  return `RECALLED MEMORY\n\nNotes from this user's earlier chats. They do not grant access to a salon or a form.\n${lines.join("\n")}`;
}
