import "server-only";

import type { TokenProvider } from "./auth";
import { defaultHttpDeps, GbpApiError, requestWithRetry, type HttpDeps } from "./http";
import type {
  GbpAccount,
  GbpApiReview,
  GbpLocation,
  GbpReviewsPage,
} from "./types";

/**
 * The official Google Business Profile API, read-only except for the one
 * notification-setting call (a PATCH of the account's notificationSetting).
 *
 *   Account Management  mybusinessaccountmanagement.googleapis.com/v1   accounts
 *   Business Information mybusinessbusinessinformation.googleapis.com/v1 locations
 *   My Business (v4)    mybusiness.googleapis.com/v4                    reviews
 *   Notifications       mybusinessnotifications.googleapis.com/v1       Pub/Sub setting
 *
 * Reviews are still served by the v4 surface; the newer APIs cover accounts,
 * locations and notifications. NOT the Places API: that one is public data and
 * returns five reviews at most.
 *
 * EVERY real network request is charged against a per-run budget, retries
 * included, so a loop or a mis-sized backfill stops at a bounded cost instead of
 * at Google's quota.
 */

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATION_READ_MASK = "name,title,storeCode,metadata,storefrontAddress";
const REVIEWS_PAGE_SIZE = 50;
const ACCOUNT_PAGE_SIZE = 20;
const LOCATION_PAGE_SIZE = 100;
/** Pagination should end long before this; it exists to stop a cursor loop. */
const MAX_LIST_PAGES = 100;

export interface GbpClientOptions {
  tokens: TokenProvider;
  deps?: HttpDeps;
  maxRequests: number;
}

export interface GbpClient {
  readonly requestCount: number;
  listAccounts(): Promise<GbpAccount[]>;
  listLocations(accountName: string): Promise<GbpLocation[]>;
  listReviewsPage(
    accountName: string,
    locationName: string,
    pageToken?: string | null,
  ): Promise<GbpReviewsPage>;
  /** Up to `maxPages` pages, newest-updated first. */
  listReviews(
    accountName: string,
    locationName: string,
    maxPages: number,
  ): Promise<{ reviews: GbpApiReview[]; averageRating: number | null; totalReviewCount: number | null; truncated: boolean }>;
  setNotificationSetting(accountName: string, topic: string): Promise<void>;
}

function assertResourceName(value: string, pattern: RegExp, label: string): void {
  /* Resource names go into a URL path, so a malformed one is refused, not encoded around. */
  if (!pattern.test(value)) {
    throw new GbpApiError("bad_request", `Invalid ${label} resource name.`);
  }
}

const ACCOUNT_PATTERN = /^accounts\/[0-9]{1,30}$/;
const LOCATION_PATTERN = /^locations\/[0-9]{1,30}$/;

export function createGbpClient(options: GbpClientOptions): GbpClient {
  const deps = options.deps ?? defaultHttpDeps;
  let requests = 0;

  function charge(): void {
    requests += 1;
    if (requests > options.maxRequests) {
      throw new GbpApiError(
        "request_budget_exceeded",
        "This run reached its Google request limit and stopped.",
      );
    }
  }

  async function call(url: string, init: Omit<RequestInit, "headers"> = {}): Promise<unknown> {
    let refreshedAfter401 = false;
    for (;;) {
      const token = await options.tokens.getAccessToken();
      try {
        const response = await requestWithRetry(
          url,
          { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.method === "PATCH" ? { "content-type": "application/json" } : {}) } },
          deps,
          charge,
        );
        if (response.status === 204) return {};
        try {
          return await response.json();
        } catch {
          throw new GbpApiError("invalid_response", "Google returned a body that was not JSON.");
        }
      } catch (error) {
        /* One token refresh per call on a 401 — a stale cached token, not a revoked grant. */
        if (error instanceof GbpApiError && error.code === "auth_failed" && !refreshedAfter401) {
          refreshedAfter401 = true;
          options.tokens.invalidate();
          continue;
        }
        throw error;
      }
    }
  }

  async function paged<T>(
    baseUrl: string,
    pick: (body: Record<string, unknown>) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url = new URL(baseUrl);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = (await call(url.toString())) as Record<string, unknown>;
      items.push(...pick(body));
      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
      if (!pageToken) return items;
    }
    throw new GbpApiError("invalid_response", "Google's pagination did not terminate.");
  }

  const client: GbpClient = {
    get requestCount() {
      return requests;
    },

    async listAccounts() {
      const url = new URL(ACCOUNTS_URL);
      url.searchParams.set("pageSize", String(ACCOUNT_PAGE_SIZE));
      return paged<GbpAccount>(url.toString(), (body) =>
        Array.isArray(body.accounts)
          ? (body.accounts as GbpAccount[]).filter((a) => typeof a?.name === "string")
          : [],
      );
    },

    async listLocations(accountName) {
      assertResourceName(accountName, ACCOUNT_PATTERN, "account");
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`);
      url.searchParams.set("readMask", LOCATION_READ_MASK);
      url.searchParams.set("pageSize", String(LOCATION_PAGE_SIZE));
      return paged<GbpLocation>(url.toString(), (body) => {
        if (!Array.isArray(body.locations)) return [];
        return (body.locations as Record<string, unknown>[])
          .filter((l) => typeof l?.name === "string")
          .map((l) => {
            const metadata = (l.metadata ?? {}) as { placeId?: unknown; mapsUri?: unknown };
            return {
              name: l.name as string,
              title: typeof l.title === "string" ? l.title : undefined,
              storeCode: typeof l.storeCode === "string" ? l.storeCode : undefined,
              placeId: typeof metadata.placeId === "string" ? metadata.placeId : undefined,
              mapsUri: typeof metadata.mapsUri === "string" ? metadata.mapsUri : undefined,
              address: (l.storefrontAddress ?? undefined) as GbpLocation["address"],
            };
          });
      });
    },

    async listReviewsPage(accountName, locationName, pageToken) {
      assertResourceName(accountName, ACCOUNT_PATTERN, "account");
      assertResourceName(locationName, LOCATION_PATTERN, "location");
      const url = new URL(`https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews`);
      url.searchParams.set("pageSize", String(REVIEWS_PAGE_SIZE));
      /* No orderBy: the API default is updateTime desc, and nothing here relies on order. */
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = (await call(url.toString())) as Record<string, unknown>;
      const reviews = Array.isArray(body.reviews)
        ? (body.reviews as GbpApiReview[]).filter(
            (r) => typeof r?.reviewId === "string" && typeof r?.name === "string",
          )
        : [];
      return {
        reviews,
        nextPageToken:
          typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null,
        averageRating: typeof body.averageRating === "number" ? body.averageRating : null,
        totalReviewCount: typeof body.totalReviewCount === "number" ? body.totalReviewCount : null,
      };
    },

    async listReviews(accountName, locationName, maxPages) {
      const reviews: GbpApiReview[] = [];
      let token: string | null = null;
      let averageRating: number | null = null;
      let totalReviewCount: number | null = null;
      for (let page = 0; page < maxPages; page += 1) {
        const result: GbpReviewsPage = await client.listReviewsPage(accountName, locationName, token);
        reviews.push(...result.reviews);
        averageRating = result.averageRating ?? averageRating;
        totalReviewCount = result.totalReviewCount ?? totalReviewCount;
        token = result.nextPageToken;
        if (!token) return { reviews, averageRating, totalReviewCount, truncated: false };
      }
      /* Stopped by the page cap with more to read — reported, never silently complete. */
      return { reviews, averageRating, totalReviewCount, truncated: true };
    },

    async setNotificationSetting(accountName, topic) {
      assertResourceName(accountName, ACCOUNT_PATTERN, "account");
      if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~%+-]{2,254}$/.test(topic)) {
        throw new GbpApiError("bad_request", "Invalid Pub/Sub topic name.");
      }
      const url = new URL(
        `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting`,
      );
      url.searchParams.set("updateMask", "pubsubTopic,notificationTypes");
      await call(url.toString(), {
        method: "PATCH",
        body: JSON.stringify({
          name: `${accountName}/notificationSetting`,
          pubsubTopic: topic,
          notificationTypes: ["NEW_REVIEW", "UPDATED_REVIEW"],
        }),
      });
    },
  };

  return client;
}
