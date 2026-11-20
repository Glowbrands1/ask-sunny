import { appConfig } from "./app-config";

/**
 * ============================================================================
 * WHAT THE SCREEN SHOWS WHILE THE LOOP WORKS (rebuild plan PR 6, item 5)
 * ============================================================================
 *
 * One short status per tool step, from the tool's NAME and its input only: no model call, and never a reading of the
 * manager's message. Display only: the route streams it to the browser (`api/streamed-response.ts`, version 2) and it
 * is never part of the reply, the chat history or a trace. The one input echoed is find_staff's name (what the manager
 * typed, back to them), as plain text: markup characters dropped, spaces collapsed, at most 40 characters.
 */

export const STATUS_NAME_MAX = 40;

/** A tool with no status of its own (a test keeps every loop tool off it, so a new tool cannot slip through). */
export const DEFAULT_STATUS = "Working on it…";

/** A name as plain text for the status line: no markdown or HTML characters, one line, at most 40 characters. */
export function plainStatusName(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/[<>*_`#[\]()\\|~{}]/g, " ").replace(/\s+/g, " ").trim() : "";
  return text.length > STATUS_NAME_MAX ? `${text.slice(0, STATUS_NAME_MAX - 1).trimEnd()}…` : text;
}

export function progressStatus(tool: string, args: unknown): string {
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (tool) {
    case "find_staff": {
      const name = plainStatusName(input.name);
      return name ? `Looking up ${name}…` : "Looking up your staff…";
    }
    case "list_staff":
      return "Looking up your staff…";
    case "read_policy":
      return "Reading the policy…";
    case "search_knowledge":
      return "Searching the knowledge base…";
    case "propose_form":
    case "coach_team":
      return "Building the card…";
    case "edit_form":
      return "Updating the form…";
    case "read_form":
      return "Reading the form…";
    case "find_past_forms":
    case "open_form":
      return "Checking forms on file…";
    case "read_reviews":
      return "Reading your reviews…";
    case "read_stats":
      return "Checking the numbers…";
    case "read_form_deletions":
      return "Checking the deletion record…";
    case "app_help":
      return `Checking ${appConfig().appName}'s help…`;
    default:
      return DEFAULT_STATUS;
  }
}
