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
