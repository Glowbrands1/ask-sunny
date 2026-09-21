"use client";

import { useState } from "react";
import { Check, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
import { usePreference, writePreference } from "@/lib/utils/client-store";

/**
 * ============================================================================
 * "ASK SUNNY FOUND CONVERSATIONS STORED ON THIS DEVICE."
 * ============================================================================
 *
 * THE ONLY PATH FROM A BROWSER'S OLD HISTORY TO AN ACCOUNT, and it is a button
 * a person presses.
 *
 * WHY IT IS A PROMPT AND NOT A BACKGROUND TASK. Conversations held in a
 * browser predate any promise that Ask Sunny would keep them. They contain what
 * managers asked about named employees' attendance and performance. Copying
 * them to a server because a page rendered would be taking someone's private
 * record and putting it somewhere they did not choose — which is not a
 * migration however it is described in a changelog.
 *
 * So: nothing is sent until Import is pressed. "Not now" sends NOTHING — no
 * count, no ids, no probe. It writes one flag in this browser so the prompt
 * stops asking, and that flag never leaves the device.
 *
 * WHAT IT WILL NEVER OFFER. The six seeded demo threads every production
 * browser holds. `eligibleForImport` drops them structurally before this
 * component can count them, and the server refuses them again — they are
 * fabricated, and a fabricated conversation in somebody's real history cannot
 * be undone by apologising for it.
 *
 * WHAT IT SAYS ABOUT THE LOCAL COPY, because people ask: nothing is removed
 * from this browser by importing. The local copy stays exactly where it is.
 */

/**
 * Per-browser, per-device, and deliberately not per-account.
 *
 * "Not now" is a statement about THIS browser's stored conversations, and those
 * are the same conversations whoever signs in here is looking at. Keying the
 * dismissal to an account would re-ask on every sign-in about history that has
 * already been declined once.
 */
const DISMISSED_KEY = "ask-sunny:import-local-history-dismissed";

export function ImportLocalHistoryPrompt() {
  const { importableConversations, importLocalConversations } = useAppStore();
  const dismissed = usePreference("local", DISMISSED_KEY, "") === "true";

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; error: string | null } | null>(
    null,
  );

  const count = importableConversations.length;

  /*
   * NOT RENDERED AT ALL when there is nothing to offer — which is the ordinary
   * case for everybody who has already imported, for every new account, and in
   * demo mode. A banner that says "0 conversations found" is a banner that
   * trains people to dismiss banners.
   */
  if (result?.imported) {
    return (
      <div className="mx-auto mb-3 flex w-full max-w-3xl items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3.5 py-2.5">
        <Check className="size-3.5 shrink-0 text-status-ready" aria-hidden />
        <p className="text-[12px] leading-relaxed text-foreground">
          {result.imported === 1
            ? "1 conversation is now on your account and will be there on your other devices."
            : `${result.imported} conversations are now on your account and will be there on your other devices.`}{" "}
          <span className="text-muted-foreground">
            They are still stored on this device too.
          </span>
        </p>
      </div>
    );
  }

  if (count === 0 || dismissed) return null;

  return (
    <div className="mx-auto mb-3 w-full max-w-3xl rounded-[var(--radius-sm)] border border-border bg-surface px-3.5 py-3 shadow-soft">
      <p className="text-[12.5px] leading-relaxed text-foreground">
        Ask Sunny found{" "}
        {count === 1 ? "1 conversation" : `${count} conversations`} stored on this
        device. Import {count === 1 ? "it" : "them"} to your account so{" "}
        {count === 1 ? "it is" : "they are"} available on your other devices?
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Nothing is sent unless you choose Import. Your conversations stay private
        to your account, and this device keeps its own copy either way.
      </p>

      {result?.error ? (
        <p role="alert" className="mt-2 text-[11.5px] leading-relaxed text-status-failed">
          {result.error} Nothing on this device was changed — you can try again.
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              const summary = await importLocalConversations();
              setResult({
                imported: summary.imported.length,
                error: summary.error,
              });
            } catch (error) {
              setResult({
                imported: 0,
                error:
                  error instanceof Error && error.message
                    ? error.message
                    : "Ask Sunny could not import those conversations just now.",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload className="size-3" />
          {busy ? "Importing…" : "Import"}
        </Button>
        {/*
          NOT NOW SENDS NOTHING. It writes one string in this browser's own
          localStorage and returns. There is no request on this path — not a
          count, not an id, not an acknowledgement — which is the whole point of
          the option existing.
        */}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => writePreference("local", DISMISSED_KEY, "true")}
        >
          <X className="size-3" />
          Not now
        </Button>
      </div>
    </div>
  );
}
