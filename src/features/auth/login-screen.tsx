"use client";

import { Suspense, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChartColumn,
  ClipboardCheck,
  Info,
  Lock,
  MessageSquareText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { DEMO_SWITCHABLE_ROLES } from "@/data/switchable-roles";
import { ACTIVE_BRAND } from "@/lib/brand";
import { supabasePublicConfigured } from "@/lib/config/runtime";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import type { Role } from "@/types";
import { SunnyMascot } from "@/components/sunny-mascot";
import { SignInForm } from "./sign-in-form";
import styles from "./login-screen.module.css";

/**
 * ============================================================================
 * THE SIGN-IN SCREEN, in whichever of three states this deployment is in.
 * ============================================================================
 *
 *   REAL AUTH CONFIGURED -> the working form. Email and password go to Supabase
 *   Auth; the server decides everything that follows. See `SignInForm`.
 *
 *   DEMO MODE -> the role switcher, unchanged. A presentation aid that handles
 *   no credential of any kind.
 *
 *   LIVE MODE, NOTHING CONFIGURED -> a notice naming what is missing. Not a
 *   dead form, and not a demo entry either: a deployment that asked for live
 *   mode and cannot authenticate anybody should say so rather than quietly
 *   offering a preview.
 *
 * The three are mutually exclusive and the order matters. Real auth is checked
 * FIRST, so a deployment that has it never shows a demo entry point.
 */
export function LoginScreen({
  /**
   * Set on the `/login` route so a successful sign-in navigates into the app.
   * The AppShell renders this component inline instead, where signing in simply
   * flips session state and the app appears — no navigation needed.
   */
  navigateOnSignIn,
}: {
  navigateOnSignIn?: boolean;
} = {}) {
  const { demoMode, signInAsDemo, role } = useSession();
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role>(role);

  /*
   * The same condition `getAuthProvider()` uses on the server, through the same
   * helper — so the screen cannot offer a form the server would refuse to
   * authenticate, or hide one it would accept. `supabasePublicConfigured()`
   * reads only NEXT_PUBLIC_ variables, which Next inlines, so it gives the same
   * answer in the browser as it does on the server.
   */
  const realAuth = !demoMode && supabasePublicConfigured();

  const handlePreview = () => {
    signInAsDemo(selectedRole);
    if (navigateOnSignIn) router.push("/");
  };

  return (
    <main id="main" className={styles.page}>
      {/* Left — the sign-in panel */}
      <section className={styles.left}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <SunriseMark className={styles.brandMark} />
            <span className={styles.brandWord}>
              {ACTIVE_BRAND.wordmark.lead} <b>{ACTIVE_BRAND.wordmark.trail}</b>
            </span>
          </div>
          <h1 className={styles.title}>Sign in to {ACTIVE_BRAND.productName}</h1>
          <p className={styles.sub}>
            {ACTIVE_BRAND.operatorName} · {ACTIVE_BRAND.brandName}
          </p>

          {realAuth ? (
            /*
             * `SignInForm` reads `useSearchParams`, so it needs a Suspense
             * boundary — without one this whole route would be forced to render
             * dynamically at the framework's insistence rather than at ours.
             */
            <Suspense fallback={<div className="mt-8 h-64" aria-hidden />}>
              <SignInForm />
            </Suspense>
          ) : (
            <form
              className="mt-8 space-y-4"
              onSubmit={(event) => event.preventDefault()}
              aria-describedby="auth-note"
            >
              <FieldGroup label="Work email" htmlFor="login-email">
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@suntancity.com"
                  disabled
                />
              </FieldGroup>

              <FieldGroup label="Password" htmlFor="login-password">
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  disabled
                />
              </FieldGroup>

              <Button type="submit" className="w-full" disabled>
                <Lock />
                Sign in
              </Button>

              <p id="auth-note" className="text-xs leading-relaxed text-muted-foreground">
                Sign-in is not configured for this deployment, so these fields
                are disabled. No password is stored, checked or transmitted
                anywhere.
              </p>
            </form>
          )}

          {realAuth ? null : demoMode ? (
            <div className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-foreground">
                  Preview the demo
                </p>
                <Badge tone="primary">Demo mode</Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Choose a role to see how navigation and permissions change. You
                can switch again at any time from the profile menu.
              </p>

              <div className="mt-4 space-y-3">
                <FieldGroup label="Sign in as" htmlFor="demo-role">
                  <Select
                    id="demo-role"
                    value={selectedRole}
                    onChange={(event) =>
                      setSelectedRole(event.target.value as Role)
                    }
                  >
                    {DEMO_SWITCHABLE_ROLES.map((demoRole) => (
                      <option key={demoRole} value={demoRole}>
                        {ROLE_LABEL[demoRole]}
                      </option>
                    ))}
                  </Select>
                </FieldGroup>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {ROLE_DESCRIPTION[selectedRole]}
                </p>
                <Button className={cn("w-full", styles.primaryAction)} onClick={handlePreview}>
                  Preview demo
                  <ArrowRight />
                </Button>
              </div>
            </div>
          ) : (
            <Notice tone="neutral" icon={<Info />} className="mt-8" title="Sign-in is not configured">
              This deployment asked for live mode but has no identity provider,
              so nobody can sign in. Set{" "}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to enable
              Supabase Auth, or <code>NEXT_PUBLIC_DEMO_MODE=true</code> for
              preview access.
            </Notice>
          )}
        </div>
      </section>

      {/* Right — what the platform is */}
      <aside className={styles.right}>
        <SunriseBackdrop />
        <div className={styles.content}>
          {/* Sunny, the clay mascot, bobbing above the pitch. */}
          <SunnyMascot className={styles.mascot} />
          <p className={styles.eyebrow}>{ACTIVE_BRAND.tagline}</p>
          <h2 className={styles.headline}>
            Everything a manager needs to run their day, in one place.
          </h2>
          {ACTIVE_BRAND.slogan ? <p className={styles.tag}>{ACTIVE_BRAND.slogan}</p> : null}
          <ul>
            {[
              {
                title: ACTIVE_BRAND.productName,
                body: "Grounded answers from your own knowledge base, with the source shown every time.",
                icon: <MessageSquareText aria-hidden />,
              },
              {
                title: "Forms and follow-ups",
                body: "Draft a coaching form in a conversation, edit every field, and never lose the follow-up.",
                icon: <ClipboardCheck aria-hidden />,
              },
              {
                title: "Reporting where the work happens",
                body: "Daily Stats, performance and Google reviews without bouncing between systems.",
                icon: <ChartColumn aria-hidden />,
              },
              /*
                "TRAINING THAT FINDS YOU" IS GONE, and it is a promise this
                product does not keep. The 14 September review: "Remove the
                fourth bullet on the right panel, 'Training that finds you'. We
                are not hosting training within the site, and the first three
                points are enough."

                Training lives in Teams and Woven. The Overview now links there
                rather than implying a library here — see
                `lib/config/training-links.ts` — and a sign-in screen that
                advertises one would be the same claim in the one place a new
                user forms their expectations.
              */
            ].map((item) => (
              <li key={item.title} className={styles.feat}>
                <span className={styles.ico}>{item.icon}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>

          {realAuth ? null : (
            <p className={styles.previewNote}>
              Preview build. Content shown throughout the app is seeded demo
              data — it is not real company policy or real salon performance.
            </p>
          )}
        </div>
      </aside>
    </main>
  );
}

/**
 * Two decimals. Server and browser trig can differ in the last bits, and an
 * unrounded coordinate is a hydration mismatch on every load.
 */
function round(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * The sign-in screen's rayed sun: twelve rays around a warm radial disc. Drawn
 * here rather than in `BrandMark` because it is this screen's larger, slowly
 * turning lockup, not the app-wide mark.
 */
function SunriseMark({ className }: { className?: string }) {
  const id = useId();
  const rays = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * Math.PI) / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x1: round(24 + 15 * cos),
      y1: round(24 + 15 * sin),
      x2: round(24 + 21 * cos),
      y2: round(24 + 21 * sin),
    };
  });
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden focusable="false">
      <defs>
        <radialGradient id={id} cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor="#FFF1B8" />
          <stop offset=".6" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#F2A900" />
        </radialGradient>
      </defs>
      {rays.map((ray, i) => (
        <line
          key={i}
          {...ray}
          stroke="#F2B705"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      ))}
      <circle cx="24" cy="24" r="10.5" fill={`url(#${id})`} />
    </svg>
  );
}

/** The half-risen sun behind the right panel: halo, rays, disc and dashed ring. */
function SunriseBackdrop() {
  const id = useId();
  const halo = `${id}-halo`;
  const disc = `${id}-disc`;
  // Thirty-six rays all the way round, alternating in strength, so the whole
  // wheel can turn without a gap ever rising into view.
  const rays = Array.from({ length: 36 }, (_, i) => {
    const angle = i * (Math.PI / 18);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x1: round(450 + 190 * cos),
      y1: round(300 + 190 * sin),
      x2: round(450 + 520 * cos),
      y2: round(300 + 520 * sin),
      opacity: i % 2 === 0 ? 0.28 : 0.5,
    };
  });
  return (
    <svg className={styles.sunrise} viewBox="0 0 900 600" fill="none" aria-hidden focusable="false">
      <defs>
        <radialGradient id={halo} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#FFD66B" stopOpacity=".9" />
          <stop offset=".5" stopColor="#F6B93B" stopOpacity=".35" />
          <stop offset="1" stopColor="#F6B93B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={disc} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#FFE9A8" />
          <stop offset="1" stopColor="#F6B93B" />
        </radialGradient>
      </defs>
      <circle className={styles.halo} cx="450" cy="300" r="420" fill={`url(#${halo})`} />
      {/* The rays sway gently around the sun's centre (still under
          reduced motion — see `.rays` in the stylesheet). */}
      <g className={styles.rays}>
      {rays.map(({ opacity, ...ray }, i) => (
        <line
          key={i}
          {...ray}
          stroke="#E0A400"
          strokeOpacity={opacity}
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}
      </g>
      <circle className={styles.disc} cx="450" cy="300" r="170" fill={`url(#${disc})`} />
      <circle
        className={styles.ring}
        cx="450"
        cy="300"
        r="205"
        stroke="#E0A400"
        strokeOpacity=".6"
        strokeWidth="3"
        strokeDasharray="6 14"
        strokeLinecap="round"
      />
    </svg>
  );
}
