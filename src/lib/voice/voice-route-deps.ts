import "server-only";

import { chatVoiceHints, l10VoiceHints } from "./keyterms";
import { supabaseVoiceUsageStore, writeVoiceTrace, type VoiceUsageStore } from "./voice-usage";

/**
 * What the voice route (`app/api/chat/voice/route.ts`) reaches outside itself, in one object so a test can put fakes
 * in their place (a route file may export only its handlers and its segment config).
 */
export interface VoiceRouteDeps {
  store: VoiceUsageStore;
  fetch: typeof fetch;
  writeTrace: (row: Record<string, unknown>) => Promise<void>;
  chatHints: typeof chatVoiceHints;
  l10Hints: typeof l10VoiceHints;
}

export const voiceRouteDeps: VoiceRouteDeps = {
  store: supabaseVoiceUsageStore,
  fetch: (input, init) => fetch(input, init),
  writeTrace: writeVoiceTrace,
  chatHints: chatVoiceHints,
  l10Hints: l10VoiceHints,
};
