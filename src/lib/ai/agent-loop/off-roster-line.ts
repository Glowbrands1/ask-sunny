/**
 * ============================================================================
 * THE NOT-ON-THE-STAFF-LIST LINE KEEPS THE FULL NAME (QA's f070, 20 Nov 2026; live chat on main 2923160b)
 * ============================================================================
 *
 * "ca for <First> <Last> for being late today, …" got "Here's the Corrective Action Form for <First>. <First> isn't on the
 * Woven staff list, so I've used the name as you typed it." The rules book says that line keeps the full name exactly as
 * typed (it is one of the lines that confirm which person it is), but the model applied the short reply name to it, in
 * some replies. Code guards it: when this turn's card came back with off_roster_name, the sentence "<name> isn't on (your
 * <place>'s | the) <staff> staff list" names that full name, in bold. The sentence is the app's own wording, matched by
 * its shape; nothing else in the reply is touched.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function withFullOffRosterName(reply: string, fullName: string, staff: string): string {
  const name = fullName.trim();
  if (!reply || !name) return reply;
  const line = new RegExp(
    String.raw`(^|[.!?]\s+|\n|,\s+)(\*\*)?([^*\n.!?,]{1,80}?)(\*\*)?(\s+(?:isn['’]t|is not) on (?:your [^\n.]{1,40}?['’]s |the )${escape(staff)} staff list)`,
    "gi",
  );
  return reply.replace(line, (whole, lead: string, open: string | undefined, typed: string, close: string | undefined, rest: string) =>
    typed.trim() === name && open && close ? whole : `${lead}**${name}**${rest}`,
  );
}
