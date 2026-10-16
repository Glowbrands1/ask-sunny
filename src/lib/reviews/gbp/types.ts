/** Shapes of the Google Business Profile API responses this integration reads. */

export interface GbpAccount {
  /** `accounts/{id}` */
  name: string;
  accountName?: string;
  type?: string;
}

export interface GbpLocation {
  /** `locations/{id}` */
  name: string;
  title?: string;
  /** Google's store code field — the same namespace as `google_review_locations.store_code`. */
  storeCode?: string;
  placeId?: string;
  mapsUri?: string;
  address?: {
    regionCode?: string;
    administrativeArea?: string;
    locality?: string;
    postalCode?: string;
    addressLines?: string[];
  };
}

export type GbpStarRating = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";

/** A review as the v4 API returns it. */
export interface GbpApiReview {
  /** `accounts/{a}/locations/{l}/reviews/{id}` */
  name: string;
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: GbpStarRating;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export interface GbpReviewsPage {
  reviews: GbpApiReview[];
  nextPageToken: string | null;
  averageRating: number | null;
  totalReviewCount: number | null;
}

/** What the Pub/Sub push carries in `message.data` (base64 JSON). */
export interface GbpNotification {
  notificationType: "NEW_REVIEW" | "UPDATED_REVIEW" | string;
  /** `accounts/{a}/locations/{l}/reviews/{id}` */
  review?: string;
  /** `accounts/{a}/locations/{l}` */
  location?: string;
}
