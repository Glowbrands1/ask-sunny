import "server-only";

import { isDemoMode } from "@/lib/config/runtime";
import { supabaseReadiness } from "@/lib/config/server-env";
import { readWovenKnowledgeStatus, type WovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";

export interface WovenKnowledgePageProps {
  /** False in demo mode, where every Woven action is refused by design. */
  liveMode: boolean;
  /** Null when Supabase is not configured for this deployment. */
  status: WovenKnowledgeStatus | null;
}

export async function loadWovenKnowledgePage(): Promise<WovenKnowledgePageProps> {
  const liveMode = !isDemoMode();
  if (!supabaseReadiness().ready) return { liveMode, status: null };
  return { liveMode, status: await readWovenKnowledgeStatus() };
}
