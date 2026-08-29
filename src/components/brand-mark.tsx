import { cn } from "@/lib/utils/cn";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * BrandMark
 * ---------------------------------------------------------------------------
 * A restrained text wordmark plus a small radiance mark drawn in CSS/SVG.
 * No final logo exists yet, and no mascot is invented here.
 *
 * When an official asset arrives, replace the contents of this component with
 * an <Image>. Nothing else in the app renders the wordmark.
 */
export function BrandMark({
  size = "md",
  className,
  showMark = true,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  showMark?: boolean;
}) {
  const text = {
    sm: "text-[13px] tracking-[0.16em]",
    md: "text-[15px] tracking-[0.18em]",
    lg: "text-[22px] tracking-[0.2em]",
  }[size];

  const markSize = { sm: "size-4", md: "size-5", lg: "size-7" }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark ? <SunMark className={markSize} /> : null}
      <span className={cn("font-semibold whitespace-nowrap uppercase", text)}>
        <span className="text-muted-foreground">{ACTIVE_BRAND.wordmark.lead}</span>
        <span className="text-foreground"> {ACTIVE_BRAND.wordmark.trail}</span>
      </span>
    </span>
  );
}

/** A quiet sun/halo mark — geometric, not illustrative. */
export function SunMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="4.4" fill="var(--primary)" />
      <circle
        cx="12"
        cy="12"
        r="8.2"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="2.6 4.2"
        opacity="0.85"
      />
    </svg>
  );
}
