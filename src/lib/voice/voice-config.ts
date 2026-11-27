import "server-only";

import { envFlag } from "@/lib/config/chat-quality-flags";
import { isDemoMode } from "@/lib/config/runtime";

/**
 * WHO GETS THE MIC (VOICE_INPUT_ENABLED, VOICE_INPUT_USERS).
 *
 *   flag off                         nobody
 *   demo mode                        nobody
 *   ASSEMBLYAI_API_KEY not set       nobody
 *   VOICE_INPUT_USERS unset / empty  nobody
 *   VOICE_INPUT_USERS "a@x, B@y"     only those emails (letter case and spaces around entries do not matter)
 *   VOICE_INPUT_USERS "*"            everyone signed in (the owner, 27 Nov 2026: "roll out the mic to all pls,
 *                                    all users + all apps")
 *
 * `VOICE_INPUT_USERS` is a server-only list: it is never logged, never sent to the browser, and the email checked
 * against it is always the verified session's (the same identity `authorizeRequest`, `pageIdentity()` and
 * `l10Viewer()` use), never one the browser sends. Voice never gives anybody access to anything: each box keeps the
 * access it has, and the voice route checks it again.
 */
export function voiceInputEnabledFor({ email }: { readonly email: string | null | undefined }): boolean {
  if (!envFlag("VOICE_INPUT_ENABLED")) return false;
  if (isDemoMode()) return false;
  if (!(process.env.ASSEMBLYAI_API_KEY ?? "").trim()) return false;
  const signedIn = (email ?? "").trim().toLowerCase();
  if (!signedIn) return false;
  const users = voiceInputUsers();
  return users.includes("*") || users.includes(signedIn);
}

function voiceInputUsers(): string[] {
  return (process.env.VOICE_INPUT_USERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}
