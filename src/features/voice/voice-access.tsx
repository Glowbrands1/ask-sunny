"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHETHER THIS PERSON GETS THE MIC (VOICE_INPUT_ENABLED). Decided on the server by the `(app)` layout
 * (`voiceInputEnabledFor`, from the verified session) and handed down as one yes/no; the pilot list itself never
 * reaches the browser. `userKey` is the person's user id, used only to remember their first-use choice in this
 * browser. With no provider (a test, a page outside the layout) voice is off.
 */
export interface VoiceAccess {
  readonly enabled: boolean;
  readonly userKey: string | null;
}

const OFF: VoiceAccess = { enabled: false, userKey: null };

const VoiceAccessContext = createContext<VoiceAccess>(OFF);

export function VoiceAccessProvider({ enabled, userKey, children }: { enabled: boolean; userKey: string | null; children: ReactNode }) {
  return <VoiceAccessContext.Provider value={enabled ? { enabled: true, userKey } : OFF}>{children}</VoiceAccessContext.Provider>;
}

export function useVoiceAccess(): VoiceAccess {
  return useContext(VoiceAccessContext);
}
