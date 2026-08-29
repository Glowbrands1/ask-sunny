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

import type { Permission } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Item is hidden unless the active role holds this permission. */
  permission?: Permission;
  /** Matches nested routes as well as the exact path. */
  matchPrefix?: boolean;
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
        label: "Reports & Analytics",
        href: "/reports",
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
        matchPrefix: true,
      },
      {
        label: "Form Monitoring",
        href: "/forms/monitoring",
        icon: FileStack,
        permission: "view_form_monitoring",
        matchPrefix: true,
      },
      {
        label: "Form Templates",
        href: "/forms/templates",
        icon: LayoutTemplate,
        permission: "manage_form_templates",
        matchPrefix: true,
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
        matchPrefix: true,
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

export function isActivePath(
  pathname: string,
  href: string,
  matchPrefix?: boolean,
): boolean {
  if (href === "/") return pathname === "/";
  if (matchPrefix) return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href || pathname.startsWith(`${href}/`);
}
