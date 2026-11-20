# L10: a To-Do gets a due date when adding and editing (Pau, 20 Nov 2026)

**Sibling app: Coding-G ports it** (Pau: "pls help add due date for both sunny and bubble").

A user asked: "I added my own To-Do's in the Ask Sunny L10, but I'm unable to include a Due Date. It simply states 'Next
wk'." Not user error: a To-Do already carries an optional `dueDate` (YYYY-MM-DD, saved in the Hub's meeting document, so
no database change), but the DM L10's Bloom-style To-dos had no date box (every new To-Do saved "Next wk"), the GM list
had one only when adding, and neither layout could change a date after. Now both layouts take a date when adding and
change it after (`Todos.tsx`; `lib/todo-due.ts`). The list shows "Due Fri, Nov 27", the Bloom layout keeps its MM-DD-YYYY;
no date keeps "Next wk". The Past meetings reader already carries `dueDate`. The L10 assistant's getMeeting and
getMeetingRecaps run in the Leadership Hub, which holds the same document.
