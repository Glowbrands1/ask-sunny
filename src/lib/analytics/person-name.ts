/**
 * A PERSON'S FULL NAME FOR THE ANALYTICS TABLES (Pau, 28 Nov 2026: "list all users per name").
 *
 * Several accounts were set up with a first name only ("Colene"), so the leader tables could not tell two people of
 * the same first name apart and read like a list of nicknames. When the account's name is one word and the email is
 * `first.last@...` with that same first name, the surname comes from the email: "Colene" + colene.smith@… is
 * "Colene Smith". Anything else is shown as it is: a name is never guessed from an email that does not agree with it.
 *
 * Display only, on the admin Analytics page; the account itself is not changed.
 */
export function fullNameFor(displayName: string, email: string | null | undefined): string {
  const name = displayName.trim();
  if (!name || /\s/.test(name) || !email) return name;
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  const parts = local.split(/[._]/).filter(Boolean);
  if (parts.length !== 2) return name;
  const [first, last] = parts;
  if (first.toLowerCase() !== name.toLowerCase() || !/^[a-z][a-z'-]*$/i.test(last)) return name;
  const surname = last
    .split(/([-'])/)
    .map((piece) => (piece === "-" || piece === "'" ? piece : piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase()))
    .join("");
  return `${name} ${surname}`;
}
