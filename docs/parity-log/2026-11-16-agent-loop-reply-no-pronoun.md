# Agent loop: the reply calls the person by name, never a pronoun (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Pau's first-name rule was a rules-book line only; live replies still wrote "nothing is on file for her" and "Her
Corrective Action Form is…". `agent-loop/reply-pronouns.ts` replaces a pronoun for the person with the turn's one
reply_name (deterministic, no model call). Quoted words and the card's account line (the manager's own words) are left
as written, and "they/them" for the blank fields or a group is not touched. Port when Ask Bubbles gets the loop.
