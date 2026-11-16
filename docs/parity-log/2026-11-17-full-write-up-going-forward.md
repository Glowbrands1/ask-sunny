# The full write-up: Going Forward is kept (17 Nov 2026)

**Sibling app: not needed now.** This is Ask Sunny's production flag setting (`src/config/production-flags.json`).
`DRAFT_NO_INVENTED_PLAN_ENABLED` is a flag both apps read. Ask Bubbles keeps its own value until its owner rules.

Pau's ruling via QA ("observation + going forward"; "I prefer the full write-up, also in Other") reverses QA's 26 Oct
rule. `DRAFT_NO_INVENTED_PLAN_ENABLED`'s only effect is removing the drafting step's "Going Forward:":
- on every Corrective Action;
- on a Coaching Form when the manager typed no plan.

That is why forms made from loop cards (e136ec2e, 7545d162, 28e76a95) lacked it. On both paths, loop and not, the flag
removed it. The flag is now off in production. QA turns it off in Vercel at merge. No code changes.

## Coaching Forms always have the policy and page (Pau, 17 Nov 2026, ~7:25 AM PHT)

The Coaching Form has no policy field. The app's citation line under the Details ("Policy reference: <Heading> Policy,
JBA Policy Manual p.N") was read from the manager's words only, so a card whose policy those words do not name saved
none.

- Create now sends the card's whole policy line (`cardPolicyLineFor`).
- The draft route writes it as that last line, in the same house format, in place of a line read otherwise.
- `nov8-policy-set-aside-coaching-create` is changed on purpose: it now asserts the line is there.

Ask Bubbles: port the same mechanism with the loop.
