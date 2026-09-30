import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";
import { fakeChatSupabase } from "@/test/fake-chat-supabase";
import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * IMPORT IS THE SAME ROUTE FOR EVERY ROLE, AND IT WIDENS NOBODY'S ACCESS
 * ============================================================================
 *
 * REPORTED: a District Manager had History but no Import. There was never a
 * role check on Import — the route asks for `ask_questions`, exactly as the
 * History list does — and these cases pin that, for every role Ask Sunny has:
 *
 *   the import route asks for `ask_questions` and nothing else, so anybody who
 *   can open History can import;
 *
 *   the permission check here is the REAL matrix, not a stub that says yes, so
 *   a future edit that gates Import to some roles fails this file;
 *
 *   what is imported is owned by the signed-in person and only they can read
 *   it back — a Regional Manager importing does not see a District Manager's
 *   history, and nobody's import reaches anybody else's.
 */

const ORIGINAL = { ...process.env };

const SCOPE: Record<Role, { level: string; primaryAreaId: string | null }> = {
  employee: { level: "salon", primaryAreaId: "loc-0101" },
  assistant_salon_director: { level: "salon", primaryAreaId: "loc-0101" },
  salon_director: { level: "salon", primaryAreaId: "loc-0101" },
  district_manager: { level: "district", primaryAreaId: "district-7" },
  regional_manager: { level: "region", primaryAreaId: "region-2" },
  admin: { level: "global", primaryAreaId: null },
  owner: { level: "global", primaryAreaId: null },
  developer: { level: "global", primaryAreaId: null },
};

/** A stable, distinct subject per role, so ownership is checkable. */
function subjectFor(role: Role): string {
  const index = ROLES.indexOf(role).toString(16).padStart(2, "0");
  return `${index}${index}${index}${index}-1111-4111-8111-111111111111`;
}

/** Every permission a route asked for, in order. */
const requested: Permission[] = [];

/** Who the next request is from. Changed between requests within a test. */
let signedInAs: Role = "district_manager";

async function load(db = fakeChatSupabase()) {
  vi.resetModules();

  vi.doMock("@/lib/auth/server", () => ({
    /*
     * THE REAL MATRIX DECIDES. A mock that always said yes would pass every
     * role whether or not the route gated it.
     */
    authorizeRequest: async (_request: Request, permission: Permission) => {
      requested.push(permission);
      const role = signedInAs;
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission)) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not include this action.");
      }
      return {
        identity: {
          subject: subjectFor(role),
          email: `${role}@example.com`,
          displayName: role,
          role,
          scope: { ...SCOPE[role], alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  }));

  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => db.client }));

  return {
    importRoute: await import("./route"),
    listRoute: await import("../route"),
    db,
  };
}

function conversationFor(role: Role) {
  const suffix = ROLES.indexOf(role).toString().padStart(4, "0");
  return {
    id: `conv_mfxrole${suffix}`,
    title: `${role} local thread`,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z",
    attachedDocumentIds: [],
    messages: [
      {
        id: `msg_mfxrole${suffix}1`,
        role: "user",
        content: `question from ${role}`,
        createdAt: "2026-08-01T09:00:00.000Z",
      },
      {
        id: `msg_mfxrole${suffix}2`,
        role: "assistant",
        content: `answer for ${role}`,
        createdAt: "2026-08-01T09:00:01.000Z",
        mode: "standard",
      },
    ],
  };
}

function importRequest(conversations: unknown[]): Request {
  return new Request("https://app.test/api/chat/conversations/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversations }),
  });
}

function probe(): Request {
  return new Request("https://app.test/api/chat/conversations/import");
}

function listRequest(): Request {
  return new Request("https://app.test/api/chat/conversations");
}

beforeEach(() => {
  vi.resetModules();
  requested.length = 0;
  signedInAs = "district_manager";
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("every role that can open History can import", () => {
  it("History and Import are gated on the same single permission", async () => {
    const { importRoute, listRoute } = await load();

    requested.length = 0;
    await listRoute.GET(listRequest());
    const historyPermissions = [...requested];

    requested.length = 0;
    await importRoute.GET(probe());
    await importRoute.POST(importRequest([conversationFor("district_manager")]));
    const importPermissions = [...new Set(requested)];

    expect(historyPermissions).toEqual(["ask_questions"]);
    expect(importPermissions).toEqual(["ask_questions"]);
  });

  it.each(ROLES)("%s holds the permission Import needs", (role) => {
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "ask_questions")).toBe(true);
  });

  it.each(ROLES)(
    "%s imports through the same route and gets the thread back in History",
    async (role) => {
      const { importRoute, listRoute, db } = await load();
      signedInAs = role;
      const local = conversationFor(role);

      const probed = await importRoute.GET(probe());
      expect(probed.status).toBe(200);

      const response = await importRoute.POST(importRequest([local]));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { imported: string[]; declined: unknown[] };
      expect(payload.imported).toEqual([local.id]);
      expect(payload.declined).toEqual([]);

      /* Owned by the person who pressed Import, and by nobody else. */
      expect(db.tables.chat_conversations).toHaveLength(1);
      expect(db.tables.chat_conversations[0]!.user_id).toBe(subjectFor(role));
      for (const row of db.tables.chat_messages) {
        expect(row.user_id).toBe(subjectFor(role));
      }

      /* And it is in their History exactly as it was on the device. */
      const listed = await listRoute.GET(listRequest());
      expect(listed.status).toBe(200);
      const history = (await listed.json()) as {
        conversations: { id: string; title: string; messages: { content: string }[] }[];
      };
      expect(history.conversations.map((entry) => entry.id)).toEqual([local.id]);
      expect(history.conversations[0]!.title).toBe(local.title);
      expect(history.conversations[0]!.messages.map((entry) => entry.content)).toEqual([
        `question from ${role}`,
        `answer for ${role}`,
      ]);
    },
  );
});

describe("importing widens nobody's access", () => {
  it("each role sees only its own imported history, never another role's", async () => {
    const { importRoute, listRoute } = await load();

    for (const role of ROLES) {
      signedInAs = role;
      const response = await importRoute.POST(importRequest([conversationFor(role)]));
      expect(response.status).toBe(200);
    }

    for (const role of ROLES) {
      signedInAs = role;

      const listed = await listRoute.GET(listRequest());
      const history = (await listed.json()) as { conversations: { id: string }[] };
      expect(history.conversations.map((entry) => entry.id)).toEqual([
        conversationFor(role).id,
      ]);

      /* The probe is scoped the same way: ids of your own threads only. */
      const probed = await importRoute.GET(probe());
      const state = (await probed.json()) as { stored: { id: string }[] };
      expect(state.stored.map((entry) => entry.id)).toEqual([conversationFor(role).id]);
    }
  });

  it("an admin importing does not pull a District Manager's threads into admin history, or the reverse", async () => {
    const { importRoute, listRoute } = await load();

    signedInAs = "district_manager";
    await importRoute.POST(importRequest([conversationFor("district_manager")]));

    signedInAs = "admin";
    await importRoute.POST(importRequest([conversationFor("admin")]));
    const adminHistory = (await (await listRoute.GET(listRequest())).json()) as {
      conversations: { id: string }[];
    };
    expect(adminHistory.conversations.map((entry) => entry.id)).toEqual([
      conversationFor("admin").id,
    ]);

    signedInAs = "district_manager";
    const dmHistory = (await (await listRoute.GET(listRequest())).json()) as {
      conversations: { id: string }[];
    };
    expect(dmHistory.conversations.map((entry) => entry.id)).toEqual([
      conversationFor("district_manager").id,
    ]);
  });

  it("re-importing another person's conversation id creates a separate, private copy rather than joining theirs", async () => {
    const { importRoute, listRoute, db } = await load();
    const shared = conversationFor("district_manager");

    signedInAs = "district_manager";
    await importRoute.POST(importRequest([shared]));
    signedInAs = "regional_manager";
    await importRoute.POST(importRequest([{ ...shared, title: "RM copy" }]));

    expect(db.tables.chat_conversations).toHaveLength(2);
    const owners = db.tables.chat_conversations.map((row) => row.user_id).sort();
    expect(owners).toEqual(
      [subjectFor("district_manager"), subjectFor("regional_manager")].sort(),
    );

    signedInAs = "district_manager";
    const dmHistory = (await (await listRoute.GET(listRequest())).json()) as {
      conversations: { title: string }[];
    };
    expect(dmHistory.conversations.map((entry) => entry.title)).toEqual([shared.title]);
  });

  it("a role without the Ask Sunny permission is still refused, and nothing is stored", async () => {
    /*
     * No shipped role lacks `ask_questions`. This is the guard that Import did
     * not become a way round the matrix: take the permission away and the
     * route refuses, exactly as History does.
     */
    const matrix = DEFAULT_PERMISSION_MATRIX.employee;
    DEFAULT_PERMISSION_MATRIX.employee = matrix.filter((entry) => entry !== "ask_questions");
    try {
      const { importRoute, listRoute, db } = await load();
      signedInAs = "employee";

      const response = await importRoute.POST(importRequest([conversationFor("employee")]));
      expect(response.status).toBe(403);
      expect((await listRoute.GET(listRequest())).status).toBe(403);
      expect(db.tables.chat_conversations).toHaveLength(0);
      expect(db.tables.chat_messages).toHaveLength(0);
    } finally {
      DEFAULT_PERMISSION_MATRIX.employee = matrix;
    }
  });
});
