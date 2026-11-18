"use client";

import { useCallback, useSyncExternalStore } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { businessToday } from "@/lib/business-date";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { usePreference, writePreference } from "@/lib/utils/client-store";

/**
 * THE "WE'RE UPDATING THE CHAT" NOTICE.
 *
 * Shown once per person per business day: OK writes today's date under a key
 * that includes the user's id, so a refresh does not bring it back, tomorrow
 * does, and a second person on a shared salon computer still sees it.
 *
 * Desktop and tablet get a centred dialog. Phones (< 640px) get a slim banner
 * under the top bar instead — a modal on a phone covers the whole screen.
 *
 * Colours are the semantic tokens only, so Ask Bubbles shows it in its own
 * palette with no change here.
 */

const KEY_PREFIX = "ask-sunny:update-notice-dismissed";
const PHONE_QUERY = "(max-width: 639px)";

/** The name in the greeting: a person's first name, or nothing at all. */
export function greetingName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  // An email-shaped display name is not a name to greet someone by.
  return first.includes("@") ? "" : first;
}

export function noticeKey(userId: string): string {
  return `${KEY_PREFIX}:${userId || "anonymous"}`;
}

function subscribePhone(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_QUERY).matches : false),
    () => false,
  );
}

function NoticeBody({ name }: { name: string }) {
  return (
    <>
      <p>
        Hello{name ? ` ${name}` : ""}! We&rsquo;re currently updating the chat to expand its
        capabilities. You can still use it to create forms as usual.
      </p>
      <p>
        If you encounter any issues, please feel free to reach out to the Admins so they can look
        into them.
      </p>
      <p>Thank you for your patience!</p>
    </>
  );
}

export function UpdateNotice({ today }: { today?: string } = {}) {
  const { user } = useSession();
  const key = noticeKey(user?.id ?? "");
  const day = today ?? businessToday();
  const dismissedOn = usePreference("local", key, "");
  // Server and first client render read "" too; the hydrated read decides.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const isPhone = useIsPhone();
  const dismiss = useCallback(() => writePreference("local", key, day), [key, day]);

  if (!hydrated || dismissedOn === day) return null;
  // A shared salon login is not a person: greet it without a name.
  const name = user?.isSalonAccount ? "" : greetingName(user?.name);

  if (isPhone) {
    return (
      <div
        role="status"
        aria-label="Chat update notice"
        className="mx-3 mt-2 flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3 text-[13px] leading-snug text-foreground shadow-soft"
      >
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1">
          Hello{name ? ` ${name}` : ""}! We&rsquo;re updating the chat — forms still work as usual.
          Any issues? Please reach out to the Admins.
        </p>
        <Button size="sm" onClick={dismiss} className="shrink-0">
          OK
        </Button>
      </div>
    );
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? null : dismiss())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--foreground)_35%,transparent)] backdrop-blur-[2px] data-[state=open]:animate-in-fade" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-[var(--radius-lg)] border border-border bg-surface p-6 text-center shadow-float data-[state=open]:animate-in-rise",
          )}
        >
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
            We&rsquo;re updating the chat
          </DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-foreground">
              <NoticeBody name={name} />
            </div>
          </DialogPrimitive.Description>
          <Button size="lg" onClick={dismiss} className="mt-5 min-w-28">
            OK
          </Button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
