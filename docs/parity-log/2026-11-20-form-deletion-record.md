# 2026-11-20 — every deleted form leaves a permanent record (f066)

**Ported to Ask Bubbles** in Glowbrands1/Ask-bubbles#971 (`501fa43`). Same gap there (`form_instance_events` cascades
with the form; nothing else recorded a delete). The mechanism is ported as is: the migration
`20261120001000_form_instance_deletions.sql`, the app's who/role/how stamp before its deletes, the fake's model of the
trigger and the PGlite test. Sunny's reader is the agent loop's `read_form_deletions` (administrators only); Bubbles has
no agent loop, so its chat reads the record through a FORM DELETION RECORD block (`form-deletions-chat-read.ts`), also
administrators only. Port the loop tool with the loop.
