# Agent loop: the not-on-the-staff-list line keeps the full name (QA's f070, 20 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Live chat on main 2923160b: "ca for <First> <Last> for being late today, can you also cite the coaching that was done on
11/3" got "<First> isn't on the Woven staff list, so I've used the name as you typed it." The rules book keeps that line's
full name exactly as typed (a line that confirms which person it is), but the model applied the short reply name to it in
some replies. Code now keeps it: when this turn's card came back with off_roster_name, the sentence "<name> isn't on (your
<place>'s | the) <staff> staff list" names that full name in bold (`off-roster-line.ts`, the app's own sentence matched by
its shape). Nothing else in the reply changes.
