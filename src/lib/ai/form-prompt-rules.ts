/**
 * TWO FLAGGED RULES ON THE ANSWERING PROMPT'S FORM LINE.
 *
 * Pure string work on the finished system prompt, so the rest of the prompt —
 * the source markers, the citation rules, the manual's page rule — is the same
 * string with either flag on or off. Each flag changes one line or adds one.
 *
 * FACSIMILE_ASK_ONLY_ENABLED. Turn 1 of a Corrective Action request
 * (sibling app conv_mvnu3j932gpohx4, 25 Oct 2026) was answered "I can't write this up as a
 * corrective action document here — that's a formal HR record, and I can't
 * produce a facsimile of one or its contents." The rule it read was headed
 * "NEVER WRITE A FACSIMILE OF A COMPANY FORM". On, the line keeps what it
 * forbids, drops the word the refusal echoed, and tells the model to ask for
 * the form in one sentence and stop, never saying it cannot.
 *
 * TYPED_PRIOR_NOT_ON_FILE_ENABLED. After "previous coaching jba manual
 * 11-1-25" the answer said "Prior coaching: Coaching Form on file, dated
 * 2025-11-01" (sibling app conv_mvnsqglc2v7zuyk, 25 Oct 2026). Nothing was on file: the
 * manager had typed it. On, a rule after the form line says a step the manager
 * typed in this chat is never on file and is given in the manager's own words.
 */

/** The form line's opening, in both of the prompt's layouts. */
export const FACSIMILE_RULE_LEAD = "- NEVER WRITE A FACSIMILE OF A COMPANY FORM.";

const ASK_SENTENCE =
  'If a manager wants a form, tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop.';

const ASK_ONLY_LEAD = "- A COMPANY FORM COMES ONLY FROM THE FORMS LIBRARY, NEVER FROM YOUR ANSWER.";

const ASK_ONLY_SENTENCE =
  'If a manager wants a form or has just given you the details for one, tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop. Never say you cannot write, produce, draft or fill out the form, never call what you would write a copy or an imitation of it, and never explain why it is not written out here.';

export const TYPED_PRIOR_RULE =
  '- A PRIOR STEP THE MANAGER TYPED IN THIS CONVERSATION IS NOT ON FILE. "previous coaching jba manual 11-1-25" is what the manager told you, not a record you have seen. Give it in the manager\'s own words — for example "previous coaching: jba manual 11-1-25, as you said" — and never write that it is on file, on record or in the employee\'s file, never turn it into a form name or a date format the manager did not type, and never present it as something you checked. A form is on file only when a section below lists it as one.';

export interface FormPromptRules {
  readonly facsimileAskOnly: boolean;
  readonly typedPriorNotOnFile: boolean;
}

/** The prompt with the flagged form rules applied. Both off returns it unchanged. */
export function withFormPromptRules(prompt: string, rules: FormPromptRules): string {
  if (!rules.facsimileAskOnly && !rules.typedPriorNotOnFile) return prompt;
  return prompt
    .split("\n")
    .flatMap((line) => {
      if (!line.startsWith(FACSIMILE_RULE_LEAD)) return [line];
      const formLine = rules.facsimileAskOnly ? askOnly(line) : line;
      return rules.typedPriorNotOnFile ? [formLine, TYPED_PRIOR_RULE] : [formLine];
    })
    .join("\n");
}

function askOnly(line: string): string {
  return line
    .replace(FACSIMILE_RULE_LEAD, ASK_ONLY_LEAD)
    .replace("Do not produce a ", "Do not write out a ")
    .replace("a pasted imitation has neither", "text typed into an answer has neither")
    .replace(ASK_SENTENCE, ASK_ONLY_SENTENCE);
}
