# 2026-11-23 — Notifications in the rail, as in Ask Bubbles

**Report (Pau, 23 Nov 2026, looking at Ask Sunny as an HR approver):** "why no notification for [the approver]? should
be same as bubbles … for the form acceptance".

**Cause:** the approver did get the bell. QA confirmed: an active form_hr_approvers row, an auth match, 1 notification,
FORMS_HR_APPROVAL_ENABLED on, and #1268 deployed. But Ask Sunny showed it only in the top bar, and Pau looked in the
rail, where Ask Bubbles has a "Notifications" item.

**Change (Ask Sunny, brought in line with Ask Bubbles' `notification-bell.tsx`):**
- `features/notifications/notification-bell.tsx` gains Bubbles' `rail` variant: a "Notifications" item with the unread
  count, a tooltip when the rail is collapsed, and its panel opening to the right. The `bar` variant is unchanged.
- `components/shell/sidebar.tsx` mounts it as the rail's first item, on desktop only.
- `components/shell/app-shell.tsx` keeps the top-bar bell for phones only (`lg:hidden`), where the rail is a drawer, as
  in Bubbles. The drawer does not repeat it.
- The same people get it: `bellForLayout` is unchanged.

**The bells themselves:** "A form is waiting for your approval" and "A manager replied on a form you are approving" are
already sent the same way in both apps. `lib/forms/hr-approval.ts` matches Bubbles' except for one comment, and its
callers are the same. No change.

**Sunny-only styling:** the rail item uses Ask Sunny's own nav-item style (rounded pill, its rail ink and hover), not
Bubbles' bordered button. **Sibling app:** not needed; this brings Sunny to Bubbles' existing behaviour.

## Same day: "Bubbles approvals ↗" on Form Monitoring

**Request (Pau, 23 Nov 2026, via QA):** an approver who works in both apps needs Ask Bubbles' pending approvals from
Ask Sunny's Form Monitoring.

**Change (Ask Sunny only):** a "Bubbles approvals ↗" tab next to "All forms" and "Pending HR approval". It is a plain
link to Ask Bubbles' own Forms Register on its Pending HR approval view (`/forms/monitoring?view=hr`), built from the
same Ask Bubbles address the app switcher uses (`bubblesHrApprovalsUrl()` in `lib/config/app-switcher.ts`). It is shown
only to people who already get the app switcher (`pageShowsAppSwitcher`). It has no count, no data crosses between the
apps, and Ask Bubbles checks its own login on arrival.

**Sibling app:** not ported. The request was for Ask Sunny's page. A matching "Sunny approvals ↗" tab on Bubbles' Forms
Register would be a separate ask.
