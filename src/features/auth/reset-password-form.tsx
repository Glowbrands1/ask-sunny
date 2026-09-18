"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { readRecoveryLink } from "@/lib/auth/recovery-link";
import { safeInternalPath } from "@/lib/auth/safe-navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

/**
 * ============================================================================
 * CREATE A NEW PASSWORD.
 * ============================================================================
 *
 * This screen now CONSUMES THE RECOVERY LINK as well as setting the password,
 * and that is the fix. It used to assume a session already existed, established
 * by `/auth/recovery` (a `?code=` exchange) or `/auth/accept` (a fragment). The
 * first of those can only ever see a PKCE link: `#access_token=…` is a URL
 * fragment and a browser never transmits one to a server. So an implicit
 * recovery link reached a route handler that saw an empty request, concluded
 * the link was spent, and redirected to `/login` — carrying the fragment along,
 * because browsers re-attach a fragment to a redirect target that has none.
 * The person landed on the sign-in screen holding a live recovery session that
 * nothing on that page would ever read.
 *
 * Both link shapes genuinely reach this project: the browser's own
 * `resetPasswordForEmail` sends a PKCE challenge, while every link sent from
 * our server is implicit. So recovery lands here, and here handles both — see
 * `lib/auth/recovery-link.ts` for the parse, which is a pure function precisely
 * so that decision is testable without a DOM.
 *
 * ============================================================================
 * WHAT HAPPENS TO THE CREDENTIAL IN THE URL
 * ============================================================================
 *
 * THE URL IS SCRUBBED BEFORE ANYTHING ELSE HAPPENS, synchronously, before any
 * `await`. `history.replaceState` rewrites the CURRENT history entry, so the
 * entry the browser is sitting on stops carrying the token — it is out of the
 * address bar, out of the back button, and out of anything that later reads
 * `document.location`. A slow network can therefore never leave a recovery
 * token sitting in the URL bar of an unattended screen.
 *
 * Doing it ourselves also avoids the library's own cleanup, which assigns
 * `window.location.hash = ""`. That is a same-document NAVIGATION: it adds a
 * history entry and leaves the previous one — the one holding the token —
 * still in the back stack.
 *
 * The tokens are handed to Supabase and dropped. They are never logged, never
 * rendered, never held in state that outlives the call, and never sent to an
 * Ask Sunny endpoint.
 *
 * ============================================================================
 * THE PASSWORD
 * ============================================================================
 *
 * It goes to `supabase.auth.updateUser({ password })` and nowhere else. Ask
 * Sunny has no password table, hashes nothing, and stores nothing: Supabase
 * Auth is the credential authority and duplicating any part of that would mean
 * owning a credential store we have no business owning. The value is held in
 * component state only while the field is on screen and is cleared the instant
 * the change succeeds.
 *
 * The minimum length is a floor this form enforces so somebody is told BEFORE
 * submitting; the real policy lives in Supabase Auth's own settings, which is
 * the only place that can enforce it for every path in.
 *
 * NOTHING IN THIS FILE LOGS.
 */

const MIN_LENGTH = 12;

/* --------------------------------------------------------------- the phases */

type Phase =
  /** Reading the link and asking the auth server whether it produced a session. */
  | { kind: "checking" }
  /** A recovery session is in hand. Show the form. */
  | { kind: "ready" }
  /**
   * Spent, expired, or never a recovery link at all. `message` is set only for
   * a CONFIGURATION failure, which is a different sentence from a dead link and
   * must not be dressed up as one.
   */
  | { kind: "invalid"; message?: string }
  /** The password is changed. Say so before navigating away. */
  | { kind: "done" };

/* ------------------------------------------------------------ password field */

/**
 * A password input with a show/hide toggle.
 *
 * The toggle is a real `<button type="button">` — inside a form, a button with
 * no explicit type submits it, which here would mean revealing the password and
 * attempting the change in the same click.
 *
 * `aria-pressed` rather than a swapped label, so a screen reader announces the
 * control's STATE instead of a name that changes under it. The icon is
 * decorative; the accessible name stays constant.
 */
function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  autoFocus,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <FieldGroup label={label} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          autoFocus={autoFocus}
          className="pr-10"
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          disabled={disabled}
          aria-pressed={visible}
          aria-controls={id}
          aria-label={`Show ${label.toLowerCase()}`}
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      </div>
    </FieldGroup>
  );
}

/* ------------------------------------------------------------ the rule list */

/**
 * The rules, shown as they are met rather than only on refusal.
 *
 * Somebody choosing a password should be able to see what is being asked while
 * they type. Reporting it only after a submit is what makes a password form
 * feel like a guessing game.
 */
function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className={
          met
            ? "flex size-4 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground [&_svg]:size-2.5"
            : "flex size-4 items-center justify-center rounded-full border border-border-strong"
        }
      >
        {met ? <Check strokeWidth={3} /> : null}
      </span>
      <span className={met ? "text-foreground" : "text-muted-foreground"}>
        {children}
      </span>
      <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
    </li>
  );
}

/* -------------------------------------------------------------- the screen */

export function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const longEnough = password.length >= MIN_LENGTH;
  const matches = password.length > 0 && password === confirm;

  /*
   * Effects run twice in development under StrictMode, and the URL has already
   * been scrubbed by the time the second pass runs. Without this guard the
   * second pass would report a spent link over a session that was just
   * established successfully.
   */
  const started = useRef(false);

  /**
   * CONSUMING THE LINK.
   *
   * A LINK THAT NO LONGER WORKS MUST SAY SO BEFORE THE FORM IS FILLED IN.
   * Recovery links are single-use and short-lived, so the common failure is one
   * already used or expired. Deciding on mount means the person is told
   * immediately rather than after typing a password twice.
   */
  const openLink = useCallback(async () => {
    if (typeof window === "undefined") return;

    const link = readRecoveryLink(window.location.search, window.location.hash);

    /*
     * SCRUB FIRST, before any `await`, and whatever was found — a refused link
     * should not leave its parameters on screen either. Everything below runs
     * with a clean URL.
     */
    window.history.replaceState(null, "", window.location.pathname);

    if (link.kind === "rejected") {
      setPhase({ kind: "invalid" });
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();

      if (link.kind === "implicit") {
        const { error: failure } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (failure) {
          // The provider's message is not surfaced: it names the token and says
          // nothing a person can act on beyond "the link did not work".
          setPhase({ kind: "invalid" });
          return;
        }
        setPhase({ kind: "ready" });
        return;
      }

      if (link.kind === "pkce") {
        const { error: failure } = await supabase.auth.exchangeCodeForSession(link.code);
        if (!failure) {
          setPhase({ kind: "ready" });
          return;
        }
        /*
         * FALL THROUGH RATHER THAN REFUSE. `detectSessionInUrl` is on by
         * default in the browser and fires while the client is constructed, so
         * the client may well have consumed this very code already — in which
         * case the exchange fails with "code verifier not found" over a session
         * that exists and is fine. Asking the auth server settles it without
         * guessing which of the two happened.
         */
      }

      /*
       * No recovery material in the URL, or a code that may already have been
       * spent by the library. Either a session exists — established here, by
       * `/auth/recovery`, by `/auth/accept`, or because the person was simply
       * signed in already — or the link is dead.
       *
       * `getUser()` rather than `getSession()`, for the same reason as
       * everywhere else in this codebase: it asks the auth server instead of
       * decoding a cookie.
       */
      const { data, error: failure } = await supabase.auth.getUser();
      setPhase(failure || !data?.user ? { kind: "invalid" } : { kind: "ready" });
    } catch (caught) {
      /*
       * A configuration failure, not a link failure: `getSupabaseBrowserClient`
       * throws when the build has no Supabase values, and its message names the
       * missing VARIABLES — what somebody debugging a deployment needs, and no
       * secret.
       */
      setPhase({
        kind: "invalid",
        message:
          caught instanceof Error ? caught.message : "This link could not be opened.",
      });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void openLink();
  }, [openLink]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!longEnough) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: failure } = await supabase.auth.updateUser({ password });

      if (failure) {
        /*
         * Surfaced, unlike the sign-in failure. There is no enumeration risk
         * here — the session already proves who this is — and the message is
         * the only way somebody learns their password was rejected for being
         * too weak or previously used.
         */
        setError(failure.message);
        setBusy(false);
        return;
      }

      // Out of React state the moment it is no longer needed.
      setPassword("");
      setConfirm("");

      /*
       * EVERY OTHER SESSION IS ENDED. A password change is the one moment an
       * account is most likely to be recovering from someone else holding a
       * credential, and Supabase leaves other refresh tokens alive by default.
       * `scope: "others"` revokes them and deliberately keeps THIS one, so the
       * person who just set the password is not thrown out of the screen they
       * are standing on.
       *
       * Best effort: a failure here must never strand somebody whose password
       * has already changed, so it is swallowed rather than surfaced.
       */
      try {
        await supabase.auth.signOut({ scope: "others" });
      } catch {
        /* Already-changed password; nothing here is worth failing over. */
      }

      /*
       * ACCEPTING THE INVITATION IS A SEPARATE STEP, and it happens here
       * because here is where we know the password was actually set.
       *
       * An invited profile is REFUSED by the auth provider, so somebody who set
       * a password and stopped would still be locked out — with a working
       * credential and no way in, which is the worst of both. The endpoint takes
       * no body and no id: the database moves the caller's own row from invited
       * to active using `auth.uid()`, and can do nothing else.
       *
       * It is idempotent, so this is safe for somebody who was already active
       * and simply used Forgot Password.
       */
      let landing = "/";
      try {
        const response = await fetch("/api/auth/accept-invitation", { method: "POST" });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          /*
           * The PASSWORD WAS CHANGED and the activation was refused — a
           * disabled account, or one with no profile. Saying so plainly beats
           * navigating into the app and bouncing them at the door, which reads
           * as the new password not having worked.
           */
          setError(
            (payload as { error?: string } | null)?.error ??
              "Your password was changed, but your account is not active. Ask an administrator.",
          );
          setBusy(false);
          return;
        }

        /*
         * The landing path is SERVER-GENERATED, from `defaultLandingForRole()`
         * against the now-active profile — the role is never resolved here.
         *
         * It is validated anyway, through the same shared rule the sign-in form
         * and the legacy callback use. Not because this value is
         * attacker-controlled today, but because three hand-rolled copies of
         * "is this path safe?" is how one of them came to accept
         * `/\evil.example` while the other two did not.
         *
         * The PATH variant, because this navigation goes through the Next
         * router rather than the browser.
         */
        landing = safeInternalPath(
          (payload as { landing?: string } | null)?.landing,
          window.location.origin,
        );
      } catch {
        /*
         * The activation could not be reached. The password change already
         * succeeded, so sending them into the app is right: if the profile is
         * still invited the page guard returns them to sign-in, which is
         * recoverable, and a retry is one more sign-in away.
         */
      }

      /*
       * SUCCESS IS SHOWN, not merely navigated through. A password change that
       * ends in a silent redirect leaves somebody unsure whether it took, and
       * this is the screen they will remember if they ever have to do it again.
       *
       * `updateUser` leaves this session in place, so the person is now signed
       * in. Refresh first so the server re-renders knowing that, then send them
       * to the screen their role can actually open.
       */
      setPhase({ kind: "done" });
      router.refresh();
      router.replace(landing);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password could not be changed right now.",
      );
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------- checking */

  if (phase.kind === "checking") {
    return (
      <p
        className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Checking your reset link…
      </p>
    );
  }

  /* -------------------------------------------------------------- expired */

  if (phase.kind === "invalid") {
    return (
      <div className="mt-8 space-y-4">
        <Notice
          tone="attention"
          title={
            phase.message
              ? "This link could not be opened"
              : "This reset link is no longer valid"
          }
        >
          {phase.message ??
            "Password reset links can be used once and expire shortly after they are sent."}
        </Notice>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Request a new one and we will email you a fresh link. Your current
          password has not been changed.
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <p className="text-center text-xs">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------- success */

  if (phase.kind === "done") {
    return (
      <div className="mt-8 space-y-4">
        <Notice tone="accent" icon={<ShieldCheck />} title="Password updated">
          Your new password is saved. Any other devices signed in to this
          account have been signed out.
        </Notice>
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Taking you to Ask Sunny…
        </p>
      </div>
    );
  }

  /* ----------------------------------------------------------- the form */

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
      {error ? (
        <Notice tone="attention" title="Could not set your password">
          {error}
        </Notice>
      ) : null}

      <PasswordField
        id="new-password"
        label="New password"
        value={password}
        onChange={setPassword}
        disabled={busy}
        autoFocus
        describedBy="password-rules"
      />

      <PasswordField
        id="confirm-password"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        disabled={busy}
      />

      <ul id="password-rules" className="space-y-1.5 text-xs leading-relaxed">
        <Requirement met={longEnough}>At least {MIN_LENGTH} characters</Requirement>
        <Requirement met={matches}>Both entries match</Requirement>
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Choose a password you have not used elsewhere. Ask Sunny never stores
        your password — it is held by Supabase Auth, and nobody here can read
        it.
      </p>

      {/*
       * ENABLED AS SOON AS BOTH FIELDS HAVE SOMETHING IN THEM, and the refusal
       * is a sentence rather than a dead control. A submit button disabled
       * until every rule passes tells somebody using a screen reader only that
       * the button is unavailable — never which rule they are failing — and the
       * checklist above is the affordance that belongs to that job.
       */}
      <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        {busy ? "Saving…" : "Set password and continue"}
      </Button>
    </form>
  );
}
