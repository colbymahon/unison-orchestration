/**
 * Server-side fetch of public agent reputation directory (Schema.org JSON-LD).
 */

const EDGE_REVIEWS =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export interface ReviewsDirectoryPayload {
  "@context"?: string;
  aggregateRating?: {
    ratingValue?: string;
    reviewCount?: number;
  };
  reviews_raw?: {
    updated_at: string;
    count: number;
    reviews: unknown[];
  };
}

export async function fetchReviewsDirectory(): Promise<ReviewsDirectoryPayload | null> {
  try {
    const res = await fetch(`${EDGE_REVIEWS}/api/v1/reviews`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReviewsDirectoryPayload;
  } catch {
    return null;
  }
}
