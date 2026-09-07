import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * ============================================================================
 * WHICH COMPANY'S KNOWLEDGE THIS BUILD SERVES
 * ============================================================================
 *
 * ONE FUNCTION, SO THERE IS ONE ANSWER. Every browser-reachable route that
 * reads or writes company knowledge calls this, and none of them reads a corpus
 * from the request. That is the whole rule, and it is in one place so it can be
 * grepped for rather than remembered six times.
 *
 * ============================================================================
 * WHY A VALID SCOPE ID IS NOT AN AUTHORIZED ONE
 * ============================================================================
 *
 * These routes used to take the corpus from `?scope=`, `body.scopeId` or a
 * multipart field and validate it with `requireScopeId` — which checks the
 * SHAPE of the value, not the caller's right to it. `bcs-core` passes that check
 * because it is a real corpus: `src/lib/brand` defines Buff City Soap alongside
 * Sun Tan City.
 *
 * So an authenticated Sun Tan City manager, holding every permission they are
 * supposed to hold, could name another company's corpus and have the server use
 * it — to list it, search it, upload into it, re-index it, download from it, or
 * delete from it. `authorizeRequest` did not stop it and was never going to: it
 * proves WHO the caller is and WHAT they may do, not WHICH company's knowledge
 * this deployment serves.
 *
 * A CORPUS IS A PROPERTY OF THE BUILD. It is fixed at deploy time by
 * `ACTIVE_BRAND`, it is the same for every request and every user, and nothing
 * a browser sends can change it. So it is read from the build.
 *
 * ============================================================================
 * NOT THE USER'S AccessScope
 * ============================================================================
 *
 * `AccessScope` — salon, district, region — says which LOCATIONS a manager
 * covers inside one brand. The knowledge corpus is the brand itself. They are
 * different questions with similarly-shaped answers, and deriving one from the
 * other would break the day a second brand ships while quietly widening access
 * before then.
 *
 * ============================================================================
 * WHAT ABOUT THE OBSOLETE CLIENT FIELDS
 * ============================================================================
 *
 * They are not read. Not validated-then-ignored, not defaulted-if-absent — the
 * routes simply no longer look. First-party clients stopped sending them too,
 * because a client that keeps sending an authority-looking value is an
 * invitation for a future server edit to start trusting it again.
 */
export function activeKnowledgeCorpus(): string {
  return ACTIVE_BRAND.knowledgeScopeId;
}
