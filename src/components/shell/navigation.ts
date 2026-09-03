import {
  BarChart3,
  FilePlus2,
  FileStack,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  MessageCircle,
  PlugZap,
  Sparkles,
  Star,
  Users,
  Video,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";
import type { Permission } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Item is hidden unless the active role holds this permission. */
  permission?: Permission;
  /**
   * The path that marks this item active, when it differs from where the item
   * NAVIGATES to.
   *
   * Needed wherever a sidebar entry names a SECTION but opens that section's
   * default page. "Reports & Analytics" opens Salon Performance directly — a
   * manager should not have to pick a report before seeing one — but it must
   * stay highlighted across every reporting route, including the drill-down and
   * the reports added later. Keying the highlight on `href` would light up on
   * Salon Performance and go dark on Sales Totals, which reads as having left
   * the section.
   *
   * Matched as a prefix, exactly as `href` is.
   */
  activePrefix?: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
  /** Administrative sections are visually marked and permission-gated. */
  admin?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "home",
    label: "Home",
    items: [{ label: "Overview", href: "/", icon: LayoutDashboard }],
  },
  {
    id: "assistant",
    label: "Assistant",
    items: [
      {
        label: "Ask Sunny",
        href: "/chat",
        icon: MessageCircle,
        permission: "ask_questions",
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      {
        /*
         * Goes STRAIGHT to the dashboard. `/reports` used to render a separate
         * screen of seeded demo figures carrying this same title, so the only
         * way to reach the real thing was to know its URL. `/reports` now
         * redirects here, and this entry skips even that hop.
         */
        label: "Reports & Analytics",
        href: REPORTS_DEFAULT_PATH,
        activePrefix: REPORTS_SECTION_PATH,
        icon: BarChart3,
        permission: "view_reports",
      },
      {
        label: "Google Reviews",
        href: "/reviews",
        icon: Star,
        permission: "view_google_reviews",
      },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      { label: "Knowledge Base", href: "/knowledge", icon: Library },
      {
        label: "Videos",
        href: "/videos",
        icon: Video,
        permission: "view_videos",
      },
    ],
  },
  {
    id: "forms",
    label: "Forms",
    items: [
      {
        label: "Create a Form",
        href: "/forms/create",
        icon: FilePlus2,
      },
      {
        label: "Form Monitoring",
        href: "/forms/monitoring",
        icon: FileStack,
        permission: "view_form_monitoring",
      },
      {
        label: "Form Templates",
        href: "/forms/templates",
        icon: LayoutTemplate,
        permission: "manage_form_templates",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [{ label: "Manager Resources", href: "/resources", icon: Wrench }],
  },
  {
    id: "admin",
    label: "Admin",
    admin: true,
    items: [
      {
        label: "AI Usage",
        href: "/admin/ai-usage",
        icon: Gauge,
        permission: "view_ai_usage",
      },
      {
        label: "User Management",
        href: "/admin/users",
        icon: Users,
        permission: "manage_users",
      },
      {
        label: "Integrations",
        href: "/admin/integrations",
        icon: PlugZap,
        permission: "manage_integrations",
      },
    ],
  },
];

export const ICONS = { Sparkles };

/**
 * Whether a sidebar item is the one the current route belongs to.
 *
 * Every item matches as a prefix, so a nested route keeps its section lit:
 * `/reports/salon-performance/0468` belongs to Reports & Analytics, and
 * `/forms/create/step-2` to Create a Form. `/` is the exception, because a
 * prefix match on it would mark Overview active everywhere.
 *
 * Items carrying `activePrefix` are matched on that instead of on `href` — see
 * the field's own note for why the two differ.
 *
 * (An earlier `matchPrefix` flag on NavItem is gone. Both of its branches were
 * the same expression, so items setting it and items not setting it behaved
 * identically; it described a distinction the function never made.)
 */
export function isActivePath(
  pathname: string,
  item: Pick<NavItem, "href" | "activePrefix">,
): boolean {
  const target = item.activePrefix ?? item.href;
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}
