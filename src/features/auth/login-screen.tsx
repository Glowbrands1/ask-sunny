"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Info, Lock, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { DEMO_SWITCHABLE_ROLES } from "@/data/demo/users";
import { ACTIVE_BRAND } from "@/lib/brand";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import type { Role } from "@/types";

/**
 * Login prototype.
 *
 * There is no authentication here by design: no password is checked, hashed,
 * compared or stored, and the form fields are disabled. The screen exists to
 * show the intended experience. `NEXT_PUBLIC_DEMO_MODE=true` exposes the
 * "Preview demo" action that grants access.
 *
 * PRODUCTION: replace the disabled form with Microsoft Entra ID or Supabase
 * Auth. Every person gets their own login; salon-level accounts sign in under
 * the salon email address as a Salon Director. Nothing about the surrounding
 * app changes — it reads the session, not the credential.
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
                placeholder="you@jbaoperations.com"
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
              Authentication is not built in this prototype. These fields are
              disabled — no password is stored, checked, or transmitted anywhere.
            </p>
          </form>

          {demoMode ? (
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
            <Notice tone="neutral" icon={<Info />} className="mt-8">
              Demo mode is off. Set <code>NEXT_PUBLIC_DEMO_MODE=true</code> in{" "}
              <code>.env.local</code> to enable preview access.
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

        <p className="mt-10 max-w-md text-xs leading-relaxed text-subtle-foreground">
          Phase 1 prototype. Content shown throughout the app is seeded demo
          data — it is not real company policy or real salon performance.
        </p>
      </aside>
    </main>
  );
}
