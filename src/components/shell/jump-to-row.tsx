"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  FilePlus2,
  LineChart,
  MessageCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { DASHBOARD_QUICK_ACTIONS } from "@/data/demo/dashboard";

export const QUICK_ACTION_ICONS: Record<string, LucideIcon> = {
  "message-circle": MessageCircle,
  "file-plus": FilePlus2,
  "line-chart": LineChart,
  "calendar-check": CalendarCheck,
};

/**
 * THE SHORTCUT ROW, IN THE CHROME.
 *
 * They used to be white elevated cards on the canvas, directly above the Ask
 * Sunny card — which made the quietest content on the page the loudest object
 * on it. The direction's argument is that they are NAVIGATION: every one
 * of them already exists in the left rail, so they belong in the dark chrome as
 * one uniform row, out of the hero's way.
 *
 * ONE TREATMENT FOR THE WHOLE ROW. No single highlighted chip: the row is a set
 * of equal shortcuts, and if one needs to lead it leads by being first.
 *
 * THE OUTLINE AND THE ICONS ARE YELLOW, asked for directly after seeing the
 * hovered chip and preferring it to the resting one. So the hover treatment is
 * now the resting treatment, and hover keeps somewhere to go: the LABEL turns
 * yellow on hover, which lands the hovered chip exactly where the requested
 * screenshot had it.
 *
 * THE LABEL STAYS LIGHT AT REST for the same reason the row is in the chrome at
 * all. A row of solid yellow text is the whole row shouting, and it would
 * out-weigh the band's yellow send button directly beneath it. An outline and a
 * 12px glyph are enough to carry the colour.
 *
 * OVERVIEW ONLY. The direction places this row structurally in the chrome but
 * only ever demonstrates it above the band, and a permanent row on every screen
 * would duplicate the rail over dense report tables the artifact never shows.
 * If the click data justifies it later, widening the condition is a one-line
 * change; the row can also come out entirely, which the direction anticipates.
 */
export function JumpToRow() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <nav
      aria-label="Shortcuts"
      className="hidden shrink-0 flex-wrap items-center gap-1.5 border-b border-chrome-border bg-chrome px-5 py-2.5 lg:flex"
    >
      {DASHBOARD_QUICK_ACTIONS.map((action) => {
        const Icon = QUICK_ACTION_ICONS[action.iconKey] ?? Sparkles;
        const className =
          "inline-flex items-center gap-2 rounded-full border border-brand-yellow px-3 py-1.5 text-[10.5px] font-bold text-band-chip-foreground transition-colors hover:text-brand-yellow";

        const content = (
          <>
            <Icon className="size-3 shrink-0 text-brand-yellow" aria-hidden />
            {action.label}
          </>
        );

        return action.external ? (
          <a
            key={action.id}
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {content}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <Link key={action.id} href={action.href} className={className}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
