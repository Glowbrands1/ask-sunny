/**
 * ============================================================================
 * THE BROWSER NEVER FILLS IN AN HR FORM
 * ============================================================================
 *
 * A District Manager's Corrective Action "Other" box arrived filled with text
 * from an earlier form. Nothing in Ask Bubbles copies one form's answers into
 * another; the browser does. Every form field has the same id on every form
 * of that template, so the browser's own form history offered — and on a tap,
 * entered — what was typed into the last one, about somebody else.
 *
 * So every text input and text area on a form card says `autocomplete="off"`.
 * That is the one value every browser honours for its form history, which is
 * what produced this. A made-up token ("nope") is sometimes used to stop
 * Chrome's address autofill as well, but Firefox and Safari read an unknown
 * token as "on" and would offer the history again, so it is not used here.
 *
 * Spread onto the element: `<Textarea {...NO_AUTOFILL} … />`. Checkboxes and
 * the sign-in forms are deliberately not touched.
 */
export const NO_AUTOFILL = { autoComplete: "off" } as const;
