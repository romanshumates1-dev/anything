import type { Metadata } from "next";
import { ReviewsContent } from "./ReviewsContent";
import { fetchReviewsPage } from "@/app/api/reviews/queries";

export const metadata: Metadata = {
  title: "Reviews",
  description: "Verified customer reviews for DealFlow AI. See what real users say about our automated wholesaling platform.",
  openGraph: {
    title: "DealFlow AI Reviews",
    description: "Customer testimonials and ratings for DealFlow AI.",
  },
};

// Fetched server-side (same query helper GET /api/reviews uses — see
// queries.ts) so the schema.org markup below is present in the initial,
// crawlable HTML rather than only appearing after a client-side fetch.
async function getInitialReviews() {
  try {
    return await fetchReviewsPage({ page: 1, sort: null, stars: null });
  } catch (error) {
    console.error("reviews page: initial fetch failed", error);
    return null;
  }
}

export default async function ReviewsPage() {
  const initial = await getInitialReviews();

  // schema.org AggregateRating rendered server-side so it's present in the
  // initial HTML (crawlable) — and ONLY when the data behind it is real:
  // never emitted while demo/sample data is what's actually on the page
  // (hasDemoData), and never with zero real reviews.
  const showStructuredData = initial && !initial.hasDemoData && initial.aggregate.count > 0;

  return (
    <div className="py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {showStructuredData && (
          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Product",
                name: "DealFlow AI",
                aggregateRating: {
                  "@type": "AggregateRating",
                  ratingValue: initial!.aggregate.average,
                  reviewCount: initial!.aggregate.count,
                },
              }),
            }}
          />
        )}
        <ReviewsContent initialData={initial} />
      </div>
    </div>
  );
}
