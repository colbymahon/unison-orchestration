import type { Metadata } from "next";
import StorefrontPage from "@/components/StorefrontPage";

export const metadata: Metadata = {
  other: {
    "base:app_id": "6a1a76c711d30a39b5246d95",
  },
};

export default function HomePage() {
  return <StorefrontPage />;
}
