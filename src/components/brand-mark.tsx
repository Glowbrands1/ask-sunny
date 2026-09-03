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
  onDark = false,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  showMark?: boolean;
  /**
   * Rendered against the navy top bar rather than the page canvas.
   *
   * A separate flag rather than inheriting `currentColor`, because the two
   * halves of the wordmark are deliberately different colours and only one of
   * them changes: ASK goes from muted grey to a light tint, while SUNNY is the
   * brand yellow in both places. Inheriting would have flattened them into one
   * colour and lost the mark.
   */
  onDark?: boolean;
}) {
  const text = {
    sm: "text-[13px] tracking-[0.16em]",
    md: "text-[15px] tracking-[0.18em]",
    lg: "text-[22px] tracking-[0.2em]",
  }[size];

  const markSize = { sm: "size-4", md: "size-5", lg: "size-7" }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark ? <SunMark className={markSize} onDark={onDark} /> : null}
      <span className={cn("font-semibold whitespace-nowrap uppercase", text)}>
        <span className={onDark ? "text-topbar-foreground" : "text-muted-foreground"}>
          {ACTIVE_BRAND.wordmark.lead}
        </span>
        {/* SUNNY is the brand yellow. The approved treatment, and the one part
            of the wordmark that is the same on either background. */}
        <span className={onDark ? "text-brand-yellow" : "text-foreground"}>
          {" "}
          {ACTIVE_BRAND.wordmark.trail}
        </span>
      </span>
    </span>
  );
}

/**
 * The sun mark — geometric, not illustrative, and a real vector.
 *
 * On the navy bar it becomes a SOLID YELLOW sun with rays: the approved
 * treatment, and the dashed halo that reads as a quiet detail on a pale canvas
 * disappears at this size against a dark ground. On the canvas it keeps the
 * softer original.
 *
 * An SVG rather than an emoji, deliberately. An emoji renders as whatever the
 * viewer's OS ships — a different sun on macOS, Windows and Android, none of
 * them the brand colour, and it cannot be recoloured at all.
 */
export function SunMark({
  className,
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
}) {
  if (onDark) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn("shrink-0", className)}
        aria-hidden
        focusable="false"
      >
        <circle cx="12" cy="12" r="5" fill="var(--brand-yellow)" />
        <g
          stroke="var(--brand-yellow)"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          {/* Eight rays, drawn rather than dashed, so each stays crisp at 20px. */}
          <line x1="12" y1="1.6" x2="12" y2="4.2" />
          <line x1="12" y1="19.8" x2="12" y2="22.4" />
          <line x1="1.6" y1="12" x2="4.2" y2="12" />
          <line x1="19.8" y1="12" x2="22.4" y2="12" />
          <line x1="4.7" y1="4.7" x2="6.5" y2="6.5" />
          <line x1="17.5" y1="17.5" x2="19.3" y2="19.3" />
          <line x1="4.7" y1="19.3" x2="6.5" y2="17.5" />
          <line x1="17.5" y1="6.5" x2="19.3" y2="4.7" />
        </g>
      </svg>
    );
  }

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
