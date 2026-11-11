# Ask Sunny only, for now: parallel chat loads and the parallel normalizer (CHAT_PARALLEL_LOADS_ENABLED, CHAT_PARALLEL_REWRITE_ENABLED)

**Sunny fix:** QA's latency work after the slow first reply to a pasted termination letter (9 Nov 2026: 18–23 s, of which 9–11 s were spent before the answering model starts). Both flags are default off.

- **Parallel loads (a):** the turn's independent loads start together instead of one after another. These are the few-shot examples, the cited-manual grounding, the Google-reviews block, the chat data block, the recalled memory and the long-context summary.
- **Parallel normalizer (b):** the message normalizer starts alongside intent extraction.

**Ask Bubbles:** port deferred, by QA's decision on 9 Nov 2026. The stage timings (CHAT_STAGE_TIMINGS_ENABLED) are ported, in the same round. With them live, Bubbles' own trace will show where its time goes before either change is ported.

- **(a):** Bubbles' answer path is ordered differently. It has an entity-resolution step, a handbook read and a full-manual plan in that stretch. Where its loads can start needs its own check of the early returns there. A first version of the Bubbles port was written and set aside unpushed (branch `claude/chat-parallel-loads-deferred` in a coding session).
- **(b):** has no direct counterpart. Bubbles has no `normalizeForChat` call after intent extraction. Its Haiku rewrite is `rewriteRetrievalQuery`, much later in the turn, so running it in parallel is a different design. QA and coding 2 review that design as its own diff before it is written.
