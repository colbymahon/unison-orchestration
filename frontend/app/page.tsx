import StorefrontPage from "@/components/StorefrontPage";
import { BASE_APP_VERIFICATION_METADATA } from "@/lib/base-verification";

export const metadata = BASE_APP_VERIFICATION_METADATA;

export default function HomePage() {
  return <StorefrontPage />;
}
