/** Fired when a private ops API returns 401 WEBAUTHN_REQUIRED */
export const OPS_SESSION_LOST_EVENT = "unison:session-lost";

export function signalOpsSessionLost(status: number, body: unknown): void {
  if (typeof window === "undefined" || status !== 401) return;
  const record = body && typeof body === "object" ? (body as { error?: string }) : null;
  if (record?.error === "WEBAUTHN_REQUIRED") {
    window.dispatchEvent(new CustomEvent(OPS_SESSION_LOST_EVENT));
  }
}
