# 2026-11-20 — a close spelling never opens a form; one typed word never matches a two-word name

**Matcher: port to Ask Bubbles. Agent-loop part: Sunny-only for now.**

QA's live re-test after #1131: "show me forms for Tes" opened the draft of a person filed as "Test Te" with no
question. Two rules:

1. `closelySpelledEmployee` (`src/lib/forms/reopen-close-spelling.ts`, the REOPEN_CLOSE_SPELLING reader shared by the
   regular reopen path and the agent loop) now needs each word of a name on file to have its own typed word that spells
   it closely, with each typed word used once. Before this, one typed word ("tes") one letter from both "test" and "te"
   counted for both words. Ask Bubbles carries the same reader if it ported sf-s26, so port this mechanism there
   (`Port from Ask Sunny (<sha>): …`). Ask-bubbles was not attached to this session, so the port is still to do.
2. The agent loop's find_past_forms, when no form matches the typed name and exactly one name on file is a close
   spelling, now returns no forms and no best_match, only `did_you_mean` and `ask_exactly` ("Did you mean **<name>**?")
   (Pau's ruling A). Ask Bubbles has no agent loop yet, so port this with the loop.
