import "server-only";

import { ACTIVE_BRAND } from "@/lib/brand";
import { citationVerifyEnabled, requiredFieldCheckEnabled } from "@/lib/config/chat-quality-flags";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { withVerifiedCitations } from "./citation-verify";
import { withRequiredFieldList } from "./required-field-check";
import type { AskResponse } from "./types";

/**
 * Backend passes that do not change the screen.
 *
 * Each one returns the response it was given when its flag is off.
 * A manual read that fails leaves the citations as they were.
 */
export async function applyQuietQuality(response: AskResponse): Promise<AskResponse> {
  const listed = requiredFieldCheckEnabled() ? withRequiredFieldList(response) : response;
  if (!citationVerifyEnabled()) return listed;
  try {
    const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(ACTIVE_BRAND.knowledgeScopeId);
    if (!manual.ok) return listed;
    return withVerifiedCitations(listed, manual.chunks);
  } catch {
    return listed;
  }
}
