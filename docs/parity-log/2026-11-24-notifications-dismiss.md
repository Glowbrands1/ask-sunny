# 2026-11-24: Notifications: × removes one, Clear all removes every one, for the viewer only

**Port from Ask Bubbles 733e6738 (#1117).** Pau, 23 Nov 2026: "able to delete notification all or clicking x by removing
1". QA asked for the Sunny port on 24 Nov 2026. The names are Bubbles' own.

- **Panel.** One panel for every bell, `features/notifications/notifications-panel.tsx` (`NotificationsPanel`). Each row
  has an ×, and Clear all sits beside Mark all as read. Clicking a row still opens it; the × never does. The list and
  the unread badge change at once, before the server answers.
- **Server.** `dismissNotificationsAction` calls `dismissNotifications(email, ids)` in `lib/notifications/repository.ts`.
  It deletes the caller's own `app_notifications` rows only:
  - the recipient is the signed-in identity's email, never taken from the browser;
  - a delete always filters on that email, so another person's id matches no row;
  - no form or approval record is read or changed;
  - there is no migration.
- **The DM L10 bell** (`features/l10/notifications/NotificationsView.tsx`, `features/l10/ui/NotificationBell.tsx`) shows
  the same panel, with Mark all read and See all kept.
  - The out-of-app "Settings" link, which opened the Leadership Hub, is removed.
  - The meta line has normal contrast.
  - Its notes have no × or Clear all, because they live in the Hub's database, which has no dismiss function yet.
  - The error line uses Ask Sunny's own `text-status-failed`.

**Tests**, all failing before the port (13 cases):
- `lib/notifications/dismiss.test.ts`;
- `features/notifications/notification-bell.dom.test.tsx`, using Ask Sunny's bell fixtures;
- `features/l10/notifications/NotificationsView.dom.test.tsx`.

Invented people only.
