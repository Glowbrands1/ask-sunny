# The card's job title: Woven's by default, the manager's explicit instruction overrides it (Pau's rule via QA, 23 Nov 2026): Bubbles coder 4 building the same

**Rule (Pau, via QA):** the card uses the staff system's title. An explicit manager instruction for the form's title
("no, use Shift Lead"), quoted in an evidence field, overrides it; a title mentioned in passing ("my shift lead Remy",
"<P> tanning consultant at <salon>") does not. The 266-chat run's 204 and 260 are the in-passing shape.

**Mechanism (Sunny):** propose_form takes `job_title` with `job_title_evidence` (the manager's words from this request).
Code checks the words are the manager's (the request's evidence check), hold the title (as typed, or spelled out), and
are not the title right beside the person's name (`titleBesideName`: the model's title words or the title list's
patterns, next to the full or first name, with only a comma or article between). Otherwise `job_title_not_instructed`
hands it back and the card keeps the staff system's title. A kept instruction is `job_title_as_you_said` (the reply
reads "**Job title:** <title>, as you said.") and is what Create saves; `title_differs` is not given then, and it now
offers another title. Rules book: one Card replies line; fixtures re-taken.

**Ask Bubbles:** Bubbles coder 4 is building the same rule (QA, 23 Nov 2026); its entry was not on Bubbles main when
this was written. Compare the two when it lands: the input names (`job_title`, `job_title_evidence`), the reason code
and the in-passing check should match.

**Tests:** replay `nov23-agent-loop-job-title-instruction-cases.ts`: "no, use Shift Lead" sets the card and the saved
form; 260's shape (a title beside the name) is handed back and Woven's title stays; job_title with no evidence is
handed back. All fail on main.
