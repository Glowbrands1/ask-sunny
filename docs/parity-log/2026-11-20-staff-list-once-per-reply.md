# The staff list is read once per reply (QA's f056, 20 Nov 2026)

**Sibling app: not needed now.** A speed item, not a bug: Ask Bubbles' chat reads its roster through its own path with
no agent loop, where the repeated per-card reads were not measured. Port the mechanism (`withRosterReadsOncePerReply`)
if its trace timings show the same repeated reads.

One chat reply read the roster 5 to 8 times per card. The chat route now runs each request inside
`withRosterReadsOncePerReply` (`employee-roster.ts`): the raw directory reads behind the staff list (the whole directory,
the store roster, the directory facts) run once per access scope per request, and every caller gets its own copy. Never
across requests, so never across managers or turns; a failed read is not kept; outside a request every call reads, as
before. Same output: the replay pack runs through the wrapped route.
