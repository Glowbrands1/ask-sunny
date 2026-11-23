# 2026-11-23 — Notifications in the rail, as in Ask Bubbles

**Report (Pau, 23 Nov 2026, looking at Ask Sunny as an HR approver):** "why no notification for [the approver]? should
be same as bubbles … for the form acceptance".

**Cause:** the approver did get the bell. QA confirmed: an active form_hr_approvers row, an auth match, 1 notification,
FORMS_HR_APPROVAL_ENABLED on, and #1268 deployed. But Ask Sunny showed it only in the top bar, and Pau looked in the
rail, where Ask Bubbles has a "Notifications" item.

**Then (Pau, same day, of the top-bar bell):** "can we remove this and add a notification bar instead below the
overview". The exact spot was confirmed with a screenshot: in the Home group, directly under Overview, above Assistant.
Pau also asked: "make sure the form notif is still there".

**Change (Ask Sunny):**
- `features/notifications/notification-bell.tsx` gains a `rail` variant, as in Bubbles: a "Notifications" item with the
  unread count, and a tooltip when the rail is collapsed. Its panel opens to the right on desktop and below the item in
  the phone drawer.
- `components/shell/sidebar.tsx` places it directly under Overview, on desktop and in the phone drawer. Someone whose rail
  has no Overview gets it as the rail's first item, so nobody who had the bell loses it.
- `components/shell/app-shell.tsx` has no top-bar bell any more, on desktop or phone. Both rails get the bell.
- The same people get it: `bellForLayout` is unchanged. Tests check that the approver's "A form is waiting for your
  approval" and the creator's "HR approved your form" / "HR sent your form back for changes" all appear in the sidebar
  panel with the count.

**The bells themselves:** "A form is waiting for your approval" and "A manager replied on a form you are approving" are
already sent the same way in both apps. `lib/forms/hr-approval.ts` matches Bubbles' except for one comment, and its
callers are the same. No change.

**Sunny-only:** the rail item uses Ask Sunny's own nav-item style (rounded pill, its rail ink and hover), not Bubbles'
bordered button. Its place under Overview and the removal of the top-bar bell are Pau's call for Ask Sunny. **Sibling
app:** not ported. Ask Bubbles already has the rail item. Moving it under Overview there, or dropping its phone top-bar
bell, would be a separate ask.

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
