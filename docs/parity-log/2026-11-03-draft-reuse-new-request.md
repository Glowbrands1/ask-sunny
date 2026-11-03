## 3 Nov 2026: a new incident for the same person gets its own draft — ported from Ask Bubbles (DRAFT_REUSE_NEW_REQUEST_ENABLED, default off)

Found in Ask Bubbles (the 2 Nov scan, replay case nov2-p2): with
CONVERSATION_DRAFT_REUSE on, a new late-opening request reused the same chat's
trash-and-rugs draft at Create. Here CONVERSATION_DRAFT_REUSE is off in
production, so the case already holds; with it on, the case fails here too
and holds with this flag. The same mechanism behind the same flag.
