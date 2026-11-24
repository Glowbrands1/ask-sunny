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
  /**
   * HR approvers only: how many forms in this app still need their decision (Form Monitoring's "Pending HR approval"
   * count). Pau, 24 Nov 2026: "can u please not remove the notification in the bar on the left side if there are still
   * pending inside". Reading or removing a notification does not decide the form, so the bar's badge stays while this is
   * above zero. Absent or 0 for everybody else.
   */
  waitingHr?: number;
}

/** Only an in-app path ("/x", not "//host" or "https:") is kept as a link. */
export function safeNotificationHref(href: string | null | undefined): string | null {
  return href && /^\/[^/\\]/.test(href) ? href : null;
}
