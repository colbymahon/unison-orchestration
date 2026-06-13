"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Shield, Loader2 } from "lucide-react";
import { OPS_SESSION_LOST_EVENT } from "@/lib/ops-session-events";

type SessionState = {
  loading: boolean;
  authenticated: boolean;
  needsRegistration: boolean;
  error: string | null;
};

export default function DashboardAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authenticated: false,
    needsRegistration: false,
    error: null,
  });
  const [busy, setBusy] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
      const data = await res.json();
      setSession({
        loading: false,
        authenticated: !!data.authenticated,
        needsRegistration: !!data.needsRegistration,
        error: null,
      });
    } catch (e) {
      setSession({
        loading: false,
        authenticated: false,
        needsRegistration: false,
        error: e instanceof Error ? e.message : "Session probe failed",
      });
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onSessionLost = () => {
      setSession({
        loading: false,
        authenticated: false,
        needsRegistration: false,
        error: "Session expired — authenticate with Touch ID again.",
      });
    };
    const onFocus = () => {
      void refreshSession();
    };
    window.addEventListener(OPS_SESSION_LOST_EVENT, onSessionLost);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(OPS_SESSION_LOST_EVENT, onSessionLost);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSession]);

  const runRegister = async () => {
    setBusy(true);
    setSession((s) => ({ ...s, error: null }));
    try {
      const challengeRes = await fetch("/api/auth/register-challenge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const challengeJson = await challengeRes.json();
      if (!challengeRes.ok) {
        throw new Error(challengeJson.error ?? "Registration challenge failed");
      }

      const attestation = await startRegistration({
        optionsJSON: challengeJson.options,
      });

      const verifyRes = await fetch("/api/auth/register-verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyJson.error ?? "Registration verification failed");
      }

      if (verifyJson.webauthnCredentialsEnv) {
        setSession((s) => ({
          ...s,
          error: null,
        }));
        try {
          await navigator.clipboard.writeText(verifyJson.webauthnCredentialsEnv);
          alert(
            "Passkey registered. WEBAUTHN_CREDENTIALS_JSON copied to clipboard — paste into Vercel Production env and run vercel --prod."
          );
        } catch {
          console.info("WEBAUTHN_CREDENTIALS_JSON:", verifyJson.webauthnCredentialsEnv);
          alert(
            "Passkey registered. Open browser console for WEBAUTHN_CREDENTIALS_JSON, paste into Vercel, then redeploy."
          );
        }
      }

      await refreshSession();
    } catch (e) {
      setSession((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "Registration aborted",
      }));
    } finally {
      setBusy(false);
    }
  };

  const runAuthenticate = async () => {
    setBusy(true);
    setSession((s) => ({ ...s, error: null }));
    try {
      const challengeRes = await fetch("/api/auth/authenticate-challenge", {
        method: "POST",
        credentials: "include",
      });
      const challengeJson = await challengeRes.json();
      if (!challengeRes.ok) {
        if (challengeJson.needsRegistration) {
          setSession((s) => ({ ...s, needsRegistration: true }));
        }
        throw new Error(challengeJson.error ?? "Authentication challenge failed");
      }

      const assertion = await startAuthentication({
        optionsJSON: challengeJson.options,
      });

      const verifyRes = await fetch("/api/auth/verify-biometric", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyJson.error ?? "Biometric verification failed");
      }

      await refreshSession();
    } catch (e) {
      setSession((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "Authentication aborted",
      }));
    } finally {
      setBusy(false);
    }
  };

  if (session.loading) {
    return (
      <div className="ops-auth-shell">
        <p className="font-data text-xs text-cyan-400/70 tracking-[0.25em] uppercase animate-pulse">
          Verifying secure session…
        </p>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="ops-auth-shell">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#00E5FF 1px, transparent 1px), linear-gradient(90deg, #00E5FF 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />
        <div className="ops-auth-card space-y-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 shadow-[0_0_48px_rgba(0,229,255,0.15)] mx-auto">
            <Shield className="w-8 h-8 text-cyan-400" aria-hidden />
          </div>
          <div className="space-y-3">
            <p className="ops-eyebrow">Admin access</p>
            <h1 className="font-[var(--font-grotesk)] text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Biometric verification required
            </h1>
            <p className="font-[var(--font-inter)] text-sm text-white/50 leading-relaxed">
              Use Touch ID, Face ID, or Windows Hello. Sessions are sealed with an httpOnly
              cryptographic cookie—no password prompts.
            </p>
          </div>

          {session.error && (
            <p className="font-data text-xs text-red-400/90 border border-red-400/20 bg-red-400/5 rounded-lg px-4 py-3">
              {session.error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {session.needsRegistration ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runRegister()}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-data text-xs font-bold uppercase tracking-widest text-[#03050A] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-all shadow-[0_0_40px_rgba(0,229,255,0.35)]"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Fingerprint className="w-4 h-4" aria-hidden />
                )}
                Register passkey
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthenticate()}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-data text-xs font-bold uppercase tracking-widest text-[#03050A] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-all shadow-[0_0_40px_rgba(0,229,255,0.35)]"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Fingerprint className="w-4 h-4" aria-hidden />
                )}
                Authenticate
              </button>
            )}
          </div>

          <p className="font-data text-[10px] text-white/25">
            First deploy: register once, then set WEBAUTHN_CREDENTIALS_JSON on Vercel.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
