import type { Metadata } from "next";
import { CorporaClient } from "./CorporaClient";

export const metadata: Metadata = {
  title: "Data Vault",
  description:
    "Browse Unison Orchestration's 32 live vector collections spanning medicine, engineering, law, astrophysics, chemistry, manufacturing, and more. Click any corpus to inspect raw TSV ground-truth data.",
};

export default function CorporaPage() {
  return <CorporaClient />;
}
