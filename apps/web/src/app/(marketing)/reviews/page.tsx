import type { Metadata } from "next";
import { ReviewsContent } from "./ReviewsContent";

export const metadata: Metadata = {
  title: "Reviews",
  description: "Verified customer reviews for DealFlow AI. See what real users say about our automated wholesaling platform.",
  openGraph: {
    title: "DealFlow AI Reviews",
    description: "Customer testimonials and ratings for DealFlow AI.",
  },
};

export default function ReviewsPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <ReviewsContent />
      </div>
    </div>
  );
}