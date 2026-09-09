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
  const text = { sm: "text-[13px]", md: "text-[18px]", lg: "text-[22px]" }[size];
  const markSize = { sm: "size-4", md: "size-[30px]", lg: "size-9" }[size];

  return (
    /*
     * ASK SUNNY LEADS. The direction takes the mark to 30px and the wordmark to
     * 18px and puts a soft yellow glow behind the PAIR — it is the product name
     * and should be the first thing read on the bar.
     *
     * The glow sits on a ::before-style layer behind both, so it belongs to the
     * lockup rather than to the mark; a glow behind the icon alone reads as a
     * button, which is the one thing this must not look like.
     */
    <span className={cn("relative inline-flex items-center gap-3", className)}>
      {onDark ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 -left-3 size-16 -translate-y-1/2 rounded-full"
          style={{ backgroundImage: "var(--brand-glow)" }}
        />
      ) : null}
      {showMark ? <SunMark className={cn("relative", markSize)} onDark={onDark} /> : null}
      <span className={cn("wordmark relative", text)}>
        <span className={onDark ? "text-topbar-foreground" : "text-muted-foreground"}>
          {ACTIVE_BRAND.wordmark.lead}
        </span>
        {/* SUNNY is the brand yellow. The approved treatment, and the one part
            of the wordmark that is the same on either background. */}
        <span className={onDark ? "text-brand-yellow" : "text-foreground"}>
          {"\u00A0"}
          {ACTIVE_BRAND.wordmark.trail}
        </span>
      </span>
    </span>
  );
}

/**
 * The parent-brand lockup: Sun Tan City, present but not competing.
 *
 * Sits to the right of search at 10px behind a hairline, with TAN in the brand
 * yellow because that is how the real mark splits. This is a TYPE STAND-IN —
 * the direction is explicit that the official SVG should replace it before this
 * ships, and the spacing here is built to receive it.
 *
 * SUN and CITY ARE WHITE, not the muted grey they started in. Asked for
 * directly, and it lands on `--topbar-foreground` rather than on a new white:
 * that is the ink ASK already uses in the Ask Sunny mark a few pixels to the
 * left, so the two lockups on this bar share one white instead of being two
 * near-whites that never quite match. Restraint is carried by SIZE and the
 * hairline instead of by a dimmer ink, which is what "present but not
 * competing" needed to mean once the grey was gone.
 */
export function ParentBrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span aria-hidden className="h-[22px] w-px shrink-0 bg-band-border" />
      <span className="wordmark-sub text-[10px] text-topbar-foreground">
        Sun{"\u00A0"}
        <span className="text-brand-yellow">Tan</span>
        {"\u00A0"}City
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

        {/*
          SUNGLASSES.

          Drawn in the TOP-BAR colour rather than in black, so the lenses read
          as cut out of the sun and the mark stays two colours. This variant
          only ever renders on that bar, which is what makes the cut-out work.

          SHAPE MATTERS MORE THAN DETAIL AT 20px. The first attempt was two
          circles with a bridge between them, and at this size the three merged
          into one dark band across the middle — a blindfold, not sunglasses.
          What reads instead is the SILHOUETTE: a brow bar across the top with
          two rounded lenses hanging off it and a gap of yellow between them.
          Yellow still shows above the brow and below the lenses, so the disc
          stays a sun.

          The geometry is kept inside the r=5 disc at every point: the brow sits
          2 units above centre, where the disc is 4.58 wide either side.
        */}
        <g fill="var(--topbar)" stroke="none">
          {/* The brow, which doubles as the bridge. */}
          <rect x="7.9" y="9.85" width="8.2" height="0.78" rx="0.39" />
          <rect x="8.15" y="10.6" width="3.0" height="2.3" rx="0.75" />
          <rect x="12.85" y="10.6" width="3.0" height="2.3" rx="0.75" />
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
