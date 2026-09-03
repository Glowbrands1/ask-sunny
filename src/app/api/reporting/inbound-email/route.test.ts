import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APPROVED_SENDERS_ENV } from "@/lib/reporting/inbound/delivery-gate";
import { RESEND_API_KEY_ENV } from "@/lib/reporting/inbound/resend-client";
import {
  SIGNATURE_HEADERS,
  WEBHOOK_SECRET_ENV,
} from "@/lib/reporting/inbound/webhook-signature";
import { SUPABASE_URL_ENV } from "@/lib/config/server-env";

import { GET, POST } from "./route";

/**
 * THE INBOUND WEBHOOK ROUTE.
 *
 * Every secret and address below is invented apart from the two real sender
 * addresses. The route is exercised as a real request object, because what is
 * being tested is ORDERING — and ordering is a property of the handler, not of
 * the modules it calls.
 *
 * THE TEST THAT MATTERS MOST is that an unverified delivery reaches no network
 * and no database. It is asserted by watching `fetch`: if a forged request
 * causes even one outbound call, the endpoint is a way to make our server
 * fetch things on an attacker's behalf, whatever it answers afterwards.
 */

const SECRET = "whsec_aW52ZW50ZWQtcmVzZW5kLXdlYmhvb2stc2lnbmluZy1rZXk=";
const SAMUEL = "Samuel.Brockie@glowbrands.com";
const EMAIL_ID = "invented-resend-email-id-9f2c";

const PAYLOAD = {
  type: "email.received",
  created_at: "2026-09-01T08:59:00.000Z",
  data: {
    email_id: EMAIL_ID,
    from: `Brockie, Samuel <${SAMUEL}>`,
    to: ["ask-sunny-reports@intiozorie.resend.app"],
    subject: "Comp Report 2026 08 30 - Bowen, Curt",
    message_id: "<invented.upstream@glowbrands.com>",
    attachments: [
      {
        id: "att-sig",
        filename: "image001.jpg",
        content_type: "image/jpeg",
        content_disposition: "inline",
        size: 8900,
      },
      {
        id: "att-report",
        filename: "Comp Report 08.30.2026.xlsx",
        content_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content_disposition: "attachment",
        size: 11584,
      },
    ],
  },
};

/** Signs as Svix does, computed here rather than through the module. */
function sign(rawBody: string, id: string, timestamp: string): string {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
}

function request(options: { body?: unknown; signed?: boolean; id?: string } = {}) {
  const rawBody = JSON.stringify(options.body ?? PAYLOAD);
  const id = options.id ?? "msg_invented_2vLp";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    options.signed === false
      ? "v1,aW52ZW50ZWQtZm9yZ2VkLXNpZ25hdHVyZS12YWx1ZS4="
      : `v1,${sign(rawBody, id, timestamp)}`;

  return new Request("https://invented.test/api/reporting/inbound-email", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADERS.id]: id,
      [SIGNATURE_HEADERS.timestamp]: timestamp,
      [SIGNATURE_HEADERS.signature]: signature,
    },
  });
}

const originalFetch = globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env[WEBHOOK_SECRET_ENV] = SECRET;
  process.env[RESEND_API_KEY_ENV] = "re_invented_api_key_value";
  process.env[APPROVED_SENDERS_ENV] = SAMUEL;
  process.env[SUPABASE_URL_ENV] = "https://invented.supabase.test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_invented_value";

  // Any outbound call is a failure in the tests below; none should reach it.
  fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env[WEBHOOK_SECRET_ENV];
  delete process.env[RESEND_API_KEY_ENV];
  delete process.env[APPROVED_SENDERS_ENV];
  delete process.env[SUPABASE_URL_ENV];
  delete process.env.SUPABASE_SECRET_KEY;
});

describe("the signature is checked before anything else happens", () => {
  it("answers 401 for a forged signature and makes no outbound call", async () => {
    const response = await POST(request({ signed: false }));

    expect(response.status).toBe(401);
    // THE ASSERTION THAT MATTERS. Not one byte was fetched on the caller's
    // behalf — no attachment listing, no download, no Supabase.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says nothing about WHY the signature failed", async () => {
    /*
     * "Your timestamp is stale" and "your signature is wrong" tell a prober
     * which half to fix. One answer for all of them.
     */
    const response = await POST(request({ signed: false }));
    const body = await response.json();
    expect(body).toEqual({
      status: "unauthorized",
      code: "invalid_signature",
      reason: "Invalid signature.",
    });
  });

  it("answers 401 when a signature header is missing entirely", async () => {
    const raw = JSON.stringify(PAYLOAD);
    const bare = new Request("https://invented.test/api/reporting/inbound-email", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json" },
    });
    const response = await POST(bare);
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 503 and names the variable when no signing secret is configured", async () => {
    // Ours to fix, not the caller's — and the one refusal a retry can cure.
    delete process.env[WEBHOOK_SECRET_ENV];
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.reason).toContain(WEBHOOK_SECRET_ENV);
    expect(body.reason).not.toContain(SECRET);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never returns the secret, the api key or the allowlist", async () => {
    for (const response of [
      await POST(request({ signed: false })),
      await POST(request()),
    ]) {
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(SECRET.replace(/^whsec_/, ""));
      expect(body).not.toContain("re_invented_api_key_value");
      expect(body).not.toContain("sb_secret_invented_value");
      expect(body).not.toContain(SAMUEL);
    }
  });
});

describe("which events are processed", () => {
  it("acknowledges and drops an event that is not email.received", async () => {
    // 200, so Resend does not retry a settled outcome.
    const response = await POST(
      request({ body: { type: "email.delivered", data: { email_id: EMAIL_ID } } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe("event_not_handled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acknowledges a signed payload that is not JSON", async () => {
    const raw = "not json at all";
    const id = "msg_invented_2vLp";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await POST(
      new Request("https://invented.test/api/reporting/inbound-email", {
        method: "POST",
        body: raw,
        headers: {
          [SIGNATURE_HEADERS.id]: id,
          [SIGNATURE_HEADERS.timestamp]: timestamp,
          [SIGNATURE_HEADERS.signature]: `v1,${sign(raw, id, timestamp)}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("unparseable_payload");
  });

  it("acknowledges a payload with no email id", async () => {
    const response = await POST(
      request({ body: { type: "email.received", data: { subject: "Comp Report" } } }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("missing_email_id");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the gates run before an attachment is retrieved", () => {
  it("acknowledges an unapproved sender without an outbound call", async () => {
    const response = await POST(
      request({
        body: {
          ...PAYLOAD,
          data: { ...PAYLOAD.data, from: "stranger@invented.test" },
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ignored");
    expect(body.code).toBe("sender_not_approved");
    // Verified, then gated, and STILL no network: the sender gate is before
    // the receiving API, not after it.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acknowledges an unrelated subject without an outbound call", async () => {
    const response = await POST(
      request({
        body: { ...PAYLOAD, data: { ...PAYLOAD.data, subject: "Out of office" } },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("subject_not_matched");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acknowledges an email whose attachments are all furniture", async () => {
    const response = await POST(
      request({
        body: {
          ...PAYLOAD,
          data: {
            ...PAYLOAD.data,
            attachments: [PAYLOAD.data.attachments[0]],
          },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("no_workbook_attachment");
    // The webhook metadata alone settles it, so the API is never called.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 503 when the api key is missing, before any retrieval", async () => {
    delete process.env[RESEND_API_KEY_ENV];
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("api_key_missing");
    expect(body.reason).toContain(RESEND_API_KEY_ENV);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("readiness", () => {
  it("reports whether each variable is configured, never a value", async () => {
    const body = await (await GET()).json();

    expect(body.endpoint).toBe("/api/reporting/inbound-email");
    expect(body.handledEvent).toBe("email.received");
    expect(body.configured[WEBHOOK_SECRET_ENV]).toBe(true);
    expect(body.configured[RESEND_API_KEY_ENV]).toBe(true);
    expect(body.configured[APPROVED_SENDERS_ENV]).toBe(true);
    // All three registered parsers are covered by one delivery.
    expect(body.parsers).toHaveLength(3);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("re_invented_api_key_value");
    // Whether a list exists, never its contents.
    expect(serialized).not.toContain(SAMUEL);
  });

  it("reports Sales Totals as NOT activated, and names what is missing", async () => {
    /*
     * The state this checkpoint is required to ship in. Sales Totals has a
     * parser, a schema and a dashboard, but its real sender address and subject
     * line are unknown — "STC Reports" is a display name, not an address — so
     * live email ingestion must stay off. The endpoint says so plainly, and
     * names the VARIABLES rather than any value.
     */
    const body = await (await GET()).json();
    const families = body.families as {
      key: string;
      activated: boolean;
      gaps: string[];
    }[];

    expect(families.map((family) => family.key)).toEqual(["comp_report", "sales_totals"]);

    const salesTotals = families.find((family) => family.key === "sales_totals")!;
    expect(salesTotals.activated).toBe(false);
    expect(salesTotals.gaps.join(" ")).toContain("SALES_TOTALS_APPROVED_SENDERS");
    expect(salesTotals.gaps.join(" ")).toContain("SALES_TOTALS_SUBJECT_FRAGMENT");

    // The Comp Report is unaffected by the router existing.
    expect(families.find((family) => family.key === "comp_report")!.activated).toBe(true);
  });
});
