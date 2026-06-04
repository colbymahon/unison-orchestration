/**
 * Phase 2d — Verifiable Ingestion Cryptographic Ring
 *
 * SHA-256 digest at ingest; lightweight attestation on MCP response.
 */

export interface SourceDigestRecord {
  /** Primary URL or arXiv ID */
  sourceUri: string;
  collection: string;
  sha256: string;
  ingestedAt: string;
  ingestedBy: "autonomous_knowledge_agent" | "pipeline_arxiv" | "pipeline_zero_result" | string;
  /** Optional Base L2 anchor tx */
  anchorTxHash?: string;
}

export interface ZkpAttestationSnippet {
  schema: "unison-v1";
  sourceUri: string;
  sha256: string;
  /** Compact proof blob — format TBD (Groth16 / SP1 / mock hash chain for MVP) */
  proof: string;
  verifier: "on-chain" | "edge-local";
}

export interface VerifiedVectorBundle {
  tsvBody: string;
  sourceDigest: SourceDigestRecord;
  attestation?: ZkpAttestationSnippet;
}

/** Edge MCP response — merged hash chain over delivered TSV chunks */
export interface ZkpVerificationDigestHeader {
  digest: string;
  chunkCount: number;
  verifiedAgainstKv: number;
  schema: "unison-zkp-v1";
}

export const ZKP_VERIFICATION_DIGEST_HEADER =
  "X-Unison-ZKP-Verification-Digest" as const;
