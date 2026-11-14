"use client";
// Copied from the Leadership Hub (src/app/meetings/useLeaveGuard.ts); keep in step with it. See src/features/l10/README.md.

import { useCallback, useEffect, useRef, useState } from "react";

/** Where the person was going when the guard stopped them: a link they clicked or the sign-out form. */
export type PendingLeave = { kind: "link"; anchor: HTMLAnchorElement } | { kind: "form"; form: HTMLFormElement };

/** True for a click that would take this tab to another page of the Hub. */
export function isLeavingClick(e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">, anchor: HTMLAnchorElement | null, here: Location | URL): boolean {
  if (!anchor || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, here.href);
  if (url.origin !== here.origin) return false; // another app: the browser's own leave prompt (beforeunload) covers it
  return url.pathname !== here.pathname || url.search !== here.search; // a #section link on this page is not leaving
}

/**
 * While `active` (a meeting is running on this page), leaving asks first:
 *  - closing or reloading the tab: the browser's own prompt (beforeunload);
 *  - clicking a link to another Hub page (header, sidebar, meeting bar, bell) or signing out: the click is held and
 *    `pending` is set, so the page can offer to end the meeting. `proceed()` continues where they were going,
 *    `cancel()` stays.
 * Modified clicks (new tab), other-origin links and #hash links are left alone.
 */
export function useLeaveGuard(active: boolean) {
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const allowed = useRef(false);

  useEffect(() => {
    if (!active) return;
    allowed.current = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowed.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase on the document: runs before Next's Link handler, so a held click never navigates.
    const onClick = (e: MouseEvent) => {
      if (allowed.current) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!isLeavingClick(e, anchor, window.location)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "link", anchor: anchor! });
    };
    const onSubmit = (e: SubmitEvent) => {
      if (allowed.current) return;
      const form = e.target as HTMLFormElement | null;
      if (!form?.getAttribute("action")) return;
      if (new URL(form.action, window.location.href).pathname !== "/logout") return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "form", form });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [active]);

  const cancel = useCallback(() => setPending(null), []);

  /** Carry on to where they were going (the same link or form, so Next's client navigation still applies). */
  const proceed = useCallback(() => {
    const p = pending;
    setPending(null);
    if (!p) return;
    // From here the page is on its way out (the meeting view unmounts, or the tab loads the next page), so the
    // guard stays off; it is re-armed only if the meeting goes live again on this page.
    allowed.current = true;
    if (p.kind === "link") p.anchor.click();
    // The sign-out form is a plain POST with no script of its own; submit() posts it without a second submit event.
    else p.form.submit();
  }, [pending]);

  return { pending, cancel, proceed };
}
