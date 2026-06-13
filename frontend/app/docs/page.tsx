import type { Metadata } from "next";
import { DocsClient } from "./DocsClient";

export const metadata: Metadata = {
  title: "How To Connect",
  description:
    "Simple steps to hook your app or robot helper to Unison's fact library. Find the list, ask a question, pay a tiny fee, get real answers.",
};

export default function DocsPage() {
  return <DocsClient />;
}
