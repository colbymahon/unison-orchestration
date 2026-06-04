import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

/** Stored passkey record (SimpleWebAuthn credential shape) */
export interface StoredPasskey {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

const STORE_DIR = path.join(process.cwd(), ".webauthn");
const STORE_FILE = path.join(STORE_DIR, "credentials.json");

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
};

function serialize(creds: StoredPasskey[]): StoredCredential[] {
  return creds.map((c) => ({
    id: c.id,
    publicKey: Buffer.from(c.publicKey).toString("base64"),
    counter: c.counter,
    transports: c.transports,
  }));
}

function deserialize(rows: StoredCredential[]): StoredPasskey[] {
  return rows.map((r) => ({
    id: r.id,
    publicKey: new Uint8Array(Buffer.from(r.publicKey, "base64")),
    counter: r.counter,
    transports: r.transports,
  }));
}

/** JSON string for Vercel WEBAUTHN_CREDENTIALS_JSON env */
export function exportCredentialsJson(creds: StoredPasskey[]): string {
  return JSON.stringify(serialize(creds));
}

export function loadWebAuthnCredentials(): StoredPasskey[] {
  const fromEnv = process.env.WEBAUTHN_CREDENTIALS_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as StoredCredential[];
      return deserialize(parsed);
    } catch {
      console.error("[webauthn] Invalid WEBAUTHN_CREDENTIALS_JSON");
    }
  }

  if (existsSync(STORE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as StoredCredential[];
      return deserialize(parsed);
    } catch {
      console.error("[webauthn] Failed to read .webauthn/credentials.json");
    }
  }

  return [];
}

export function saveWebAuthnCredentials(creds: StoredPasskey[]): void {
  const payload = serialize(creds);
  if (process.env.VERCEL === "1") {
    console.warn(
      "[webauthn] On Vercel, persist credentials via WEBAUTHN_CREDENTIALS_JSON env:",
      JSON.stringify(payload)
    );
    return;
  }
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export function upsertCredential(credential: StoredPasskey): StoredPasskey[] {
  const existing = loadWebAuthnCredentials();
  const next = existing.filter((c) => c.id !== credential.id);
  next.push(credential);
  saveWebAuthnCredentials(next);
  return next;
}
