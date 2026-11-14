import type { ReactNode } from "react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * ============================================================================
 * THE FRAME FOR PAGES ANYONE MAY READ, SIGNED IN OR NOT.
 * ============================================================================
 *
 * Ported from Ask Bubbles. `/about` and `/privacy` exist for Google's OAuth consent screen: a published
 * (Production) app must name a homepage and a privacy policy, and Google's
 * reviewers open both with no Ask Sunny session. So these routes live
 * OUTSIDE the `(app)` group, call no page guard, and read no data. The
 * middleware only refreshes sessions and never redirects, so nothing else
 * needs to change for them to load logged out — `public-pages.test.ts`
 * asserts both halves.
 */
export function PublicPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/about" aria-label={`${ACTIVE_BRAND.productName} — about`}>
            <BrandMark size="sm" />
          </Link>
          <Link href="/login" className="text-sm font-medium text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:py-14">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
          {title}
        </h1>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-foreground">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

/** A titled section of a public page. */
export function PublicSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** The About / Privacy / Sign in links, shared by the public pages and the sign-in screen. */
export function PublicLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="About this app" className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-center">
        <li>
          <Link href="/about" className="hover:text-foreground hover:underline">
            About {ACTIVE_BRAND.productName}
          </Link>
        </li>
        <li>
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            Privacy Policy
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-6 py-6 text-[13px] text-muted-foreground sm:flex-row sm:justify-between">
        <p>
          {ACTIVE_BRAND.productName} · operated by {ACTIVE_BRAND.operatorName}
        </p>
        <PublicLinks />
      </div>
    </footer>
  );
}
