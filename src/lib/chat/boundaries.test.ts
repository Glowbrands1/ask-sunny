import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ADMIN_CONSOLE_ROLES,
  DEFAULT_PERMISSION_MATRIX,
  PERMISSIONS,
  ROLES,
} from "@/lib/permissions";

/**
 * ============================================================================
 * WHAT PHASE 2A DELIBERATELY DOES NOT BUILD
 * ============================================================================
 *
 * Server-backed history was approved. An administrative conversation viewer was
 * NOT — not for Owner, not for Developer, not for Admin, and not behind a new
 * `view_conversation_audit` permission. The History panel still tells every
 * person "History is private to your account", and in this phase that sentence
 * is exactly true.
 *
 * A test suite can only assert that code does what it says. These assert the
 * harder and more valuable thing: that the code somebody might add next is not
 * there. They are static reads of the source, and they say so — a static check
 * cannot prove a deployed database, only that these files would build one.
 */

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function walk(dir: string, match: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = join(dir, entry);
    if (statSync(join(ROOT, relative)).isDirectory()) {
      found.push(...walk(relative, match));
    } else if (match(relative)) {
      found.push(relative);
    }
  }
  return found;
}

/** Source files, excluding the tests that describe them. */
const SOURCE = walk("src", (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));

const CHAT_ROUTES = walk("src/app/api/chat/conversations", (path) =>
  path.endsWith("route.ts"),
);

/* ------------------------------------------------- no cross-user reading -- */

describe("no code path returns another person's conversation", () => {
  it("found the routes to check at all", () => {
    /* A sweep that matched nothing would make everything below vacuous. */
    expect(CHAT_ROUTES.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every store function the caller's own id as its first argument", () => {
    const store = read("src/lib/chat/store.ts");
    const exported = [...store.matchAll(/export async function (\w+)\(\s*([^,)]+)/g)];

    expect(exported.length).toBeGreaterThanOrEqual(5);
    for (const [, name, firstArgument] of exported) {
      expect(firstArgument.trim(), `${name} must take userId first`).toMatch(/^userId/);
    }
  });

  it("scopes every chat table read and write by user_id", () => {
    const store = read("src/lib/chat/store.ts");
    /*
     * Every `.from("chat_…")` in this module is followed, within its statement,
     * by a `user_id` predicate. The one exception would be a cross-user read,
     * which is the thing that must not exist.
     */
    const statements = store.split(/\.from\(/).slice(1);
    const chatStatements = statements.filter((chunk) => chunk.startsWith('"chat_'));

    expect(chatStatements.length).toBeGreaterThanOrEqual(6);
    for (const chunk of chatStatements) {
      const statement = chunk.split(";")[0];
      /*
       * Either a predicate on a read, update or delete, or the column being
       * written on an insert or upsert. There is no third form in this module,
       * and a statement with none of them would be a cross-user access.
       */
      const scoped =
        statement.includes('.eq("user_id", userId)') ||
        statement.includes("user_id: userId");
      expect(
        scoped,
        `a chat statement without a user_id of its own: ${statement.slice(0, 160)}`,
      ).toBe(true);
    }
  });

  it("never reads an actor from a request body in a chat route", () => {
    for (const path of CHAT_ROUTES) {
      const source = read(path);
      expect(source, `${path} must not read an identity from the body`).not.toMatch(
        /body\.(userId|user_id|email|role|subject|actorId)/,
      );
      /* The identity comes from the validated session, in every handler. */
      expect(source).toContain("context.identity.subject");
    }
  });

  it("has no route that takes a bare message id", () => {
    const messageRoutes = walk("src/app/api/chat", (path) => path.endsWith("route.ts"))
      .filter((path) => /\[(message|messageId|msg)\w*\]/.test(path));
    expect(messageRoutes).toEqual([]);
  });

  it("has no admin, audit or cross-user chat route at all", () => {
    const suspicious = walk("src/app", (path) => path.endsWith("route.ts")).filter(
      (path) =>
        /conversation/i.test(path) && /admin|audit|all|search|user/i.test(path),
    );
    expect(suspicious).toEqual([]);
  });
});

/* ------------------------------------------------- no widened permissions -- */

describe("the permission model is unchanged", () => {
  it("did not add view_conversation_audit or anything like it", () => {
    for (const permission of PERMISSIONS) {
      expect(permission).not.toMatch(/conversation/i);
      expect(permission).not.toMatch(/audit/i);
    }
  });

  it("has exactly the permissions it is meant to, so a new one is deliberate", () => {
    /*
     * A BLUNT TRIPWIRE, AND THAT IS THE POINT. It does not say chat history
     * added no permission — the two assertions either side of it say that, by
     * name. It says that ANY permission added anywhere has to be acknowledged
     * here, by somebody who has just read what this file is guarding.
     *
     * 24 -> 25 is `view_l10_meetings`, added for the client's request that the
     * L10 meeting link be "restricted to admin accounts only for now". It gates
     * one external link, is granted to the administrator roles alone, and
     * touches no chat route — see `api/resources/l10`.
     */
    expect(PERMISSIONS).toHaveLength(25);
  });

  it("still has exactly the eight roles it had", () => {
    expect(ROLES).toHaveLength(8);
  });

  it("still admits the same three roles to the admin console", () => {
    expect(ADMIN_CONSOLE_ROLES).toEqual(["admin", "owner", "developer"]);
  });

  it("grants nobody a chat-reading permission, because there is none", () => {
    for (const role of ROLES) {
      for (const permission of DEFAULT_PERMISSION_MATRIX[role] ?? []) {
        expect(permission).not.toMatch(/conversation|audit/i);
      }
    }
  });

  it("gates the chat history routes on ask_questions and nothing wider", () => {
    for (const path of CHAT_ROUTES) {
      const source = read(path);
      const gates = [...source.matchAll(/authorizeRequest\(request,\s*"(\w+)"\)/g)].map(
        (match) => match[1],
      );
      expect(gates.length).toBeGreaterThan(0);
      for (const gate of gates) expect(gate).toBe("ask_questions");
      /*
       * `authorizeAdminConsoleRequest` is the wrapper that means "is this
       * person an administrator of the platform". Chat history must never use
       * it, because an administrator is not a party to somebody's conversation.
       */
      expect(source).not.toContain("authorizeAdminConsoleRequest");
    }
  });
});

/* ------------------------------------------------- analytics stays clean -- */

describe("conversation text stays out of analytics", () => {
  const ANALYTICS = walk("src/lib/analytics", (path) => path.endsWith(".ts"));

  it("found the analytics modules", () => {
    expect(ANALYTICS.length).toBeGreaterThan(5);
  });

  it("reads no chat table from any analytics module", () => {
    for (const path of ANALYTICS) {
      const source = read(path);
      expect(source, `${path} must not read chat history`).not.toContain(
        "chat_conversations",
      );
      expect(source, `${path} must not read chat history`).not.toContain("chat_messages");
    }
  });

  it("reads no chat table from the analytics screens", () => {
    for (const path of walk("src/features/admin", (entry) => /\.tsx?$/.test(entry))) {
      const source = read(path);
      expect(source).not.toContain("chat_conversations");
      expect(source).not.toContain("chat_messages");
    }
  });

  it("leaves activity_events with no column that could hold a question", () => {
    /*
     * The guarantee predates this phase and must survive it: the adoption
     * record says THAT somebody asked, never WHAT they asked.
     */
    const record = read("src/lib/analytics/record.ts");
    expect(record).not.toMatch(/\b(question|answer|prompt|content|text)\s*:/);
  });

  it("does not make the new tables reachable from any analytics view", () => {
    const migrations = walk("supabase/migrations", (path) => path.endsWith(".sql"));
    for (const path of migrations) {
      const sql = read(path);
      if (!sql.includes("create or replace view")) continue;
      expect(sql, `${path} must not join chat history into a view`).not.toContain(
        "chat_messages",
      );
    }
  });
});

/* ----------------------------------------------------- no secrets escape -- */

describe("no privileged credential can reach the browser", () => {
  it("marks the chat store server-only", () => {
    expect(read("src/lib/chat/store.ts").startsWith('import "server-only";')).toBe(true);
  });

  it("is never imported by a client component", () => {
    const clientFiles = SOURCE.filter((path) =>
      read(path).trimStart().startsWith('"use client"'),
    );
    expect(clientFiles.length).toBeGreaterThan(10);

    for (const path of clientFiles) {
      const source = read(path);
      expect(source, `${path} is a client component`).not.toContain("@/lib/chat/store");
      expect(source, `${path} is a client component`).not.toContain(
        "@/lib/supabase/server",
      );
    }
  });

  it("names no secret in any new chat module", () => {
    const modules = walk(
      "src/lib/chat",
      (entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"),
    );
    expect(modules.length).toBeGreaterThan(4);

    for (const path of modules) {
      const source = read(path);
      expect(source).not.toMatch(/SUPABASE_SECRET_KEY|SERVICE_ROLE|ANTHROPIC_API_KEY/);
      expect(source).not.toMatch(/sb_secret_|sk-ant-/);
    }
  });

  it("logs nothing from the chat store, where rows hold HR content", () => {
    const store = read("src/lib/chat/store.ts");
    expect(store).not.toMatch(/console\.(log|warn|error|info)/);
  });

  it("never returns a Postgres message to a caller", () => {
    const store = read("src/lib/chat/store.ts");
    expect(store).not.toContain("error.message");
  });
});

/* ---------------------------------------------------------- the migration -- */

describe("the migration is additive and secured", () => {
  const MIGRATION = "supabase/migrations/20260921002000_chat_history.sql";
  const sql = read(MIGRATION);
  /** Comment lines cannot satisfy or fail an assertion about statements. */
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("creates exactly the three tables", () => {
    const created = [
      ...statements.matchAll(/create table if not exists public\.(\w+)/g),
    ].map((match) => match[1]);
    expect(new Set(created)).toEqual(
      new Set(["chat_conversations", "chat_messages", "chat_history_boundaries"]),
    );
  });

  it("contains no destructive statement against anything that exists", () => {
    expect(statements).not.toMatch(/\bdrop\s+table\b/i);
    expect(statements).not.toMatch(/\bdrop\s+column\b/i);
    expect(statements).not.toMatch(/\bdrop\s+view\b/i);
    expect(statements).not.toMatch(/\bdrop\s+policy\b/i);
    expect(statements).not.toMatch(/\btruncate\b/i);
    expect(statements).not.toMatch(/\bupdate\s+public\./i);
  });

  it("drops nothing but the guard on its own trigger", () => {
    /*
     * `drop trigger if exists` before `create trigger` is the idempotency
     * pattern this schema already uses, and it targets a trigger THIS FILE
     * creates. Anything else dropped would be this migration removing
     * something it did not make.
     */
    const drops = [...statements.matchAll(/drop\s+(\w+)\s+if\s+exists\s+([\w.]+)/gi)].map(
      (match) => `${match[1].toLowerCase()} ${match[2]}`,
    );
    expect(drops).toEqual(["trigger chat_conversations_purge_on_delete"]);
    expect(statements).not.toMatch(/drop\s+(?!trigger\s+if\s+exists)/i);
  });

  it("deletes rows from exactly one place: a tombstone purging its own turns", () => {
    /*
     * The one `delete from` in this file is inside the trigger that destroys a
     * conversation's messages when it is soft-deleted — which is what makes a
     * tombstone a tombstone rather than a filing cabinet. Any other target
     * would be this migration removing data it did not create.
     */
    const targets = [...statements.matchAll(/delete\s+from\s+(?:public\.)?(\w+)/gi)].map(
      (match) => match[1].toLowerCase(),
    );
    expect(targets).toEqual(["chat_messages"]);
  });

  it("alters no existing table", () => {
    const altered = [...statements.matchAll(/alter\s+table\s+public\.(\w+)/gi)].map(
      (match) => match[1],
    );
    expect(new Set(altered)).toEqual(
      new Set(["chat_conversations", "chat_messages", "chat_history_boundaries"]),
    );
  });

  it("creates the clear boundary table and secures it like the rest", () => {
    expect(statements).toContain(
      "create table if not exists public.chat_history_boundaries",
    );
    expect(statements.replace(/\s+/g, " ")).toContain(
      "revoke all on public.chat_history_boundaries from anon, authenticated",
    );
  });

  it("ties a message's owner to its conversation's owner in the schema", () => {
    /*
     * BLOCKER 2. Every statement the application issues is scoped by the
     * session's own user id — but all of it runs under the secret key, which
     * bypasses row level security by design. So a coding bug could otherwise
     * assemble a row with one person's conversation and another's id and
     * satisfy every single-column foreign key.
     *
     * The composite key makes that pair unrepresentable, checked by the same
     * lookup that checks the conversation exists.
     */
    const flat = statements.replace(/\s+/g, " ");
    expect(flat).toContain(
      "constraint chat_conversations_id_user_key unique (id, user_id)",
    );
    expect(flat).toContain(
      "foreign key (conversation_id, user_id) references public.chat_conversations (id, user_id) on delete cascade",
    );
  });

  it("makes a titled tombstone unrepresentable", () => {
    const flat = statements.replace(/\s+/g, " ");
    expect(flat).toContain("check ((deleted_at is null) = (title is not null))");
  });

  it("purges a tombstone's turns in the database, not only in the application", () => {
    expect(statements).toContain(
      "create trigger chat_conversations_purge_on_delete",
    );
    expect(statements).toMatch(/before update on public\.chat_conversations/);
    expect(statements).toContain(
      "revoke execute on function public.chat_conversations_purge_on_delete() from public;",
    );
  });

  it("enables and forces row level security on every table it creates", () => {
    for (const table of [
      "chat_conversations",
      "chat_messages",
      "chat_history_boundaries",
    ]) {
      expect(statements).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      );
      expect(statements).toMatch(
        new RegExp(`alter table public\\.${table}\\s+force\\s+row level security`),
      );
    }
  });

  it("takes back the privileges Supabase grants the browser roles", () => {
    const flat = statements.replace(/\s+/g, " ");
    expect(flat).toContain("revoke all on public.chat_conversations from anon, authenticated");
    expect(flat).toContain("revoke all on public.chat_messages      from anon, authenticated".replace(/\s+/g, " "));
  });

  it("defines no policy, which is the policy", () => {
    /*
     * RLS enabled with no policy denies every role that does not bypass it. A
     * select policy here, however narrow, would put chat content one crafted
     * PostgREST query away from the publishable key that ships in every browser.
     */
    expect(statements).not.toMatch(/create\s+policy/i);
  });

  it("grants nothing back to anon or authenticated", () => {
    expect(statements).not.toMatch(/\bgrant\b/i);
  });

  it("does not make turn_id a foreign key", () => {
    /*
     * An imported conversation may name an event row that no longer exists, and
     * a missing analytics row must never reject somebody's own history.
     */
    expect(statements).not.toMatch(/turn_id[^,]*references/i);
  });

  it("carries the two correlation constraints that make writes idempotent", () => {
    expect(statements).toContain("unique (user_id, client_conversation_id)");
    expect(statements).toContain("unique (conversation_id, client_message_id)");
  });
});

/* ------------------------------------------------------- the privacy copy -- */

describe("the privacy promise on screen matches the behaviour", () => {
  const LIST = read("src/features/chat/conversation-list.tsx");

  it("still says history is private to your account", () => {
    expect(LIST).toContain("History is private to your account.");
    expect(LIST).toContain(
      "No conversations yet. Your chat history is private to your account.",
    );
  });

  it("no longer claims Clear history only touches this browser, in live mode", () => {
    expect(LIST).toContain(
      "Removes every conversation from your Ask Sunny account and from this browser.",
    );
  });

  it("keeps the browser-only wording for demo mode, where it is still true", () => {
    expect(LIST).toContain("Removes every conversation stored in this browser.");
  });
});
