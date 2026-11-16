# The full write-up: Going Forward is kept (17 Nov 2026)

**Sibling app: not needed now.** This is Ask Sunny's production flag setting (`src/config/production-flags.json`).
`DRAFT_NO_INVENTED_PLAN_ENABLED` is a flag both apps read. Ask Bubbles keeps its own value until its owner rules.

Pau's ruling via QA ("observation + going forward"; "I prefer the full write-up, also in Other") reverses QA's 26 Oct
rule. `DRAFT_NO_INVENTED_PLAN_ENABLED`'s only effect is removing the drafting step's "Going Forward:":
- on every Corrective Action;
- on a Coaching Form when the manager typed no plan.

That is why forms made from loop cards (e136ec2e, 7545d162, 28e76a95) lacked it. On both paths, loop and not, the flag
removed it. The flag is now off in production. QA turns it off in Vercel at merge. No code changes.
