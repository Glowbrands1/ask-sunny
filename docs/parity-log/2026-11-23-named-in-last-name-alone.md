# "Show me <last>s forms": a last name alone names the one roster person who has it (Ask Bubbles coder 2's finding): same gap in Ask Bubbles, port pending

**Report (found by Ask Bubbles coder 2 while porting, via QA, 22 Nov 2026):** the forms-on-file privacy guard's person
check (`formsOnFileAskedFor`, namedIn) read a full name or a first name, never a last name alone, so "show me <last>s
forms" was refused as someone else's forms.

**Fix (the mechanism, roster data only):** a word of the manager's quoted ask (a trailing 's read off) that is the last
name of exactly one roster person names that person, so their forms open; it is read for the quoted turn and for the
nearest earlier turn that names someone. A last name two people share names nobody (the guard stays closed). It only
lets THIS person's forms through: a last name is not read as naming someone else, since a surname can be an everyday
word ("open her account").

**Ask Bubbles: same gap.** Bubbles' `formsOnFileAskedFor` has the same namedIn. Port the read and the replay cases below
with Bubbles' roster.

**Tests:** replay `nov22-agent-loop-last-name-alone-forms-cases.ts`: "show me calders forms" and "show me Calder's
forms" fail before (refused as someone else's), pass after; controls: another person's last name and a shared last
name stay refused.
