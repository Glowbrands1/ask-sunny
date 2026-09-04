import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * The frame the credential screens share.
 *
 * Forgot-password and reset-password are the same panel with a different title
 * and a different form. Sharing it means a change to the sign-in chrome cannot
 * leave two of the three screens looking like a different product — which is
 * exactly what happens when each auth screen carries its own copy of the
 * header.
 */
export function AuthPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-sm">
        <BrandMark size="lg" />
        <h1 className="mt-9 text-[28px] leading-tight font-semibold text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {subtitle ?? `${ACTIVE_BRAND.operatorName} · ${ACTIVE_BRAND.brandName}`}
        </p>
        {children}
      </div>
    </main>
  );
}
