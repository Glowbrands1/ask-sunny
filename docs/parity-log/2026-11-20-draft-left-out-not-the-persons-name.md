# The person's own surname is never "left out" (QA's f078, 20 Nov 2026)

**Sibling app: not needed.** The post-draft check was ported from Ask Bubbles (44856eb0), where a dropped surname was the
very bug it caught ("<first> <last> … was drafted as <first> was late"). Ask Sunny's accounts name the person by their
first name on purpose (Pau's rule), so here the employee's own name words are never a fact the account left out; Ask
Bubbles keeps its check as it is unless its own rule changes.

Production dpl_5bzJ (main 9300526e): "ca for <First> <Last>, late on 11/18" drafted "<First> was late on 11/18" and the
screen said "The draft left out <Last> in Observation of Offense; tell me if you want it added." `draftFacts`
(`draft-consistency.ts`) no longer lists the employee's name words; dates and amounts are still checked. The route test's
expectation changed on purpose (now "left out 10-20-26" alone), with the reason in a comment.
