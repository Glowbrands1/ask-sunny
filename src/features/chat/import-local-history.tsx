"use client";

import { useState } from "react";
import { Check, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
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

/**
 * ONE IMPORT, TWO PLACES TO PRESS IT.
 *
 * The prompt above the thread and the Import control in the history panel both
 * run through this, which runs through the store's `importLocalConversations`
 * — the same client, the same server route, the same validation and the same
 * ownership rule. Neither surface looks at a role: Import is available to
 * everybody who can use Ask Sunny, and it only ever writes their own
 * conversations to their own account.
 */
function useLocalHistoryImport() {
  const { importableConversations, importLocalConversations, importChecked } =
    useAppStore();

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; error: string | null } | null>(
    null,
  );

  async function run() {
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
  }

  return {
    count: importableConversations.length,
    checked: importChecked,
    busy,
    result,
    run,
    reset: () => setResult(null),
  };
}

function importedSentence(imported: number): string {
  return imported === 1
    ? "1 conversation is now on your account and will be there on your other devices."
    : `${imported} conversations are now on your account and will be there on your other devices.`;
}

export function ImportLocalHistoryPrompt() {
  const { count, busy, result, run } = useLocalHistoryImport();
  const dismissed = usePreference("local", DISMISSED_KEY, "") === "true";

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
          {importedSentence(result.imported)}{" "}
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
          onClick={() => void run()}
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

/**
 * ============================================================================
 * IMPORT, IN THE HISTORY PANEL, FOR EVERYBODY
 * ============================================================================
 *
 * REPORTED: a District Manager "has History but does not see Import".
 *
 * There was never a role check on Import — not here, not in the store, not on
 * the route, which asks for `ask_questions` exactly as History does. What was
 * missing was the PROMPT, and the prompt is conditional by design: it
 * appears only when this browser holds conversations the account does not, and
 * it stops appearing forever in a browser where somebody once chose "Not now".
 * Somebody on a fresh device, or who had already imported, or who dismissed it
 * once, had no Import anywhere — and no way to tell that from "not allowed".
 *
 * So Import now also lives where History lives, always, for every role. It is
 * the same import: `useLocalHistoryImport` above, the same store function, the
 * same route. Pressing it opens a dialog that says what is on this device
 * before anything is sent — and when there is nothing to bring over, it says
 * that, rather than the control quietly not existing.
 *
 * IT IGNORES "NOT NOW". That flag silences the banner, which asks unprompted;
 * this is somebody asking on purpose.
 *
 * Opening the dialog sends nothing. Only its Import button does.
 */
export function HistoryImportButton() {
  const { count, checked, busy, result, run, reset } = useLocalHistoryImport();
  const [open, setOpen] = useState(false);

  const imported = result?.imported ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-[9.5px] font-black tracking-[0.1em] uppercase text-muted-foreground transition-colors hover:text-foreground"
      >
        <Upload className="size-2.5" aria-hidden />
        Import
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent
          title="Import conversations from this device"
          description="Brings conversations stored in this browser onto your Ask Sunny account, so they are available on your other devices."
        >
          <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
            {imported > 0 ? (
              <p className="flex items-start gap-2 text-foreground">
                <Check className="mt-1 size-3.5 shrink-0 text-status-ready" aria-hidden />
                <span>
                  {importedSentence(imported)}{" "}
                  <span className="text-muted-foreground">
                    They are still stored on this device too.
                  </span>
                </span>
              </p>
            ) : count > 0 ? (
              <>
                <p className="text-foreground">
                  {count === 1
                    ? "1 conversation stored on this device is not on your account yet."
                    : `${count} conversations stored on this device are not on your account yet.`}
                </p>
                <p>
                  Nothing is sent unless you choose Import. Your conversations stay
                  private to your account, and this device keeps its own copy either
                  way.
                </p>
              </>
            ) : checked ? (
              <p>
                There is nothing on this device to import. The conversations in this
                browser are already on your account, or were deleted from it.
              </p>
            ) : (
              <p>
                Ask Sunny could not check your account just now, so it cannot tell
                which conversations on this device still need importing. Nothing was
                sent. Try again in a moment.
              </p>
            )}

            {result?.error ? (
              <p role="alert" className="text-[12px] leading-relaxed text-status-failed">
                {result.error} Nothing on this device was changed — you can try again.
              </p>
            ) : null}
          </div>

          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost" size="sm" disabled={busy}>
                {count > 0 && imported === 0 ? "Cancel" : "Close"}
              </Button>
            </DialogClose>
            {count > 0 ? (
              <Button size="sm" disabled={busy} onClick={() => void run()}>
                <Upload className="size-3" />
                {busy ? "Importing…" : "Import"}
              </Button>
            ) : null}
          </DialogActions>
        </DialogContent>
      </Dialog>
    </>
  );
}
