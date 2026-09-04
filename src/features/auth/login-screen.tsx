"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Info, Lock, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { DEMO_SWITCHABLE_ROLES } from "@/data/demo/users";
import { ACTIVE_BRAND } from "@/lib/brand";
import { supabasePublicConfigured } from "@/lib/config/runtime";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import type { Role } from "@/types";
import { SignInForm } from "./sign-in-form";

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
    <main
      id="main"
      className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
    >
      {/* Left — the sign-in panel */}
      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <BrandMark size="lg" />
          <h1 className="mt-9 text-[28px] leading-tight font-semibold text-foreground">
            Sign in to {ACTIVE_BRAND.productName}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
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
                <Button className="w-full" onClick={handlePreview}>
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
      </div>

      {/* Right — what the platform is */}
      <aside className="hidden flex-col justify-center border-l border-border bg-surface-muted px-12 py-16 lg:flex">
        <p className="eyebrow">{ACTIVE_BRAND.tagline}</p>
        <h2 className="mt-4 max-w-md text-[26px] leading-snug font-semibold text-foreground">
          Everything a manager needs to run their day, in one place.
        </h2>
        <ul className="mt-8 max-w-md space-y-3.5">
          {[
            {
              title: "Ask Sunny",
              body: "Grounded answers from your own knowledge base, with the source shown every time.",
            },
            {
              title: "Forms and follow-ups",
              body: "Draft a coaching form in a conversation, edit every field, and never lose the follow-up.",
            },
            {
              title: "Reporting where the work happens",
              body: "Daily Stats, performance and Google reviews without bouncing between systems.",
            },
            {
              title: "Training that finds you",
              body: "Describe the problem and the right training video surfaces alongside the answer.",
            },
          ].map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
                <ShieldCheck className="size-3" aria-hidden />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-foreground">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                  {item.body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {realAuth ? null : (
          <p className="mt-10 max-w-md text-xs leading-relaxed text-subtle-foreground">
            Preview build. Content shown throughout the app is seeded demo data
            — it is not real company policy or real salon performance.
          </p>
        )}
      </aside>
    </main>
  );
}
