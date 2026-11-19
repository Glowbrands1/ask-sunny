/**
 * WHO MAY EDIT AI TRAINING: named people, not a role.
 *
 * The client asked for Manage Training to be limited to four named people.
 * Admin, owner and developer accounts that are not on the list can still read
 * the training, but not edit it.
 *
 * The list is the server variable `AI_TRAINING_EDITOR_EMAILS` (comma or
 * semicolon separated), set per deployment. It is not written here because this
 * repository is public and the list is real people's addresses. Unset or empty
 * means nobody can edit: it fails closed, never open.
 *
 * Matched on the signed-in email, ignoring case and surrounding spaces.
 */
export function aiTrainingEditorEmails(raw: string | undefined = process.env.AI_TRAINING_EDITOR_EMAILS): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function canEditAiTraining(
  identity: { email?: string | null } | null | undefined,
  editors: readonly string[] = aiTrainingEditorEmails(),
): boolean {
  const email = identity?.email?.trim().toLowerCase();
  return !!email && editors.includes(email);
}
