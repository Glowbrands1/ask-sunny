/**
 * ============================================================================
 * A CARD REPLY NAMES ITS FORM (port of Ask Bubbles #1098; its QA, 23 Nov 2026, u22 live)
 * ============================================================================
 *
 * T2 "address: 123 Test St, Lees Summit, MO. 00000" made a ready exit card, and the reply opened on "**<P>** shows as no
 * longer active in Woven; …" with no "Here's the Resignation/Exit Form for **<P>**." anywhere: the model wrote no
 * opening (no hand-back in the trace). The rules book asks every card reply to name its employee in its first line. When
 * a turn's reply comes with a card and names no form, the card's own opening goes first, built from the card (its form's
 * name and the reply name), never from a word list.
 */

const flat = (text: string) => text.toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ").trim();

/** Whether the reply names the form: its full name, or that name without a closing "Form". */
export function namesForm(reply: string, formName: string): boolean {
  const said = flat(reply);
  const name = flat(formName);
  if (!name) return true;
  const bare = name.replace(/\s+form$/, "");
  return said.includes(name) || (bare !== "" && said.includes(bare));
}

/** The reply with the card's opening first when it names no form. */
export function withCardOpening(reply: string, formName: string | null | undefined, replyName: string | null | undefined): string {
  if (!reply.trim() || !formName?.trim() || !replyName?.trim() || namesForm(reply, formName)) return reply;
  return `Here's the ${formName.trim()} for **${replyName.trim()}**.\n\n${reply.trim()}`;
}
