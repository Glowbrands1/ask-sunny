/**
 * FORM_NAME_OFF_ROSTER_ASK_ENABLED (QA, 10 Nov 2026): the level of the actor's scope this turn ("salon", "district",
 * "global", …), as the chat route entered it (`person-roster-store.ts`), so the name readers can keep round 12's
 * OFF_ROSTER_ASK_BEFORE_CARD rule — a salon manager is asked about a name not on the roster, anyone else keeps it as
 * typed. Undefined with none (a test, the browser, the flag off).
 */
let read: () => string | undefined = () => undefined;

export function installRosterScope(reader: () => string | undefined): void {
  read = reader;
}

export function rosterScopeLevel(): string | undefined {
  return read();
}
