/** One notification in the top bar's bell (`app_notifications`). */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** An in-app path, or null when there is nowhere to go. */
  href: string | null;
  createdAt: string;
  readAt: string | null;
  /**
   * Stays unread and in the list until its matter is settled (owner, 24 Nov 2026: HR's "A form is waiting for your
   * approval" stays for every approver until someone approves, rejects or sends it back). Opening it, Mark all as read,
   * the × and Clear all leave it alone. Absent means no.
   */
  pinned?: boolean;
}

export interface NewNotification {
  recipientEmail: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
}

export interface BellData {
  items: AppNotification[];
  unread: number;
}

/** Only an in-app path ("/x", not "//host" or "https:") is kept as a link. */
export function safeNotificationHref(href: string | null | undefined): string | null {
  return href && /^\/[^/\\]/.test(href) ? href : null;
}
