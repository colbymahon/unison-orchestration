"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Shield, Loader2 } from "lucide-react";

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
      <div className="min-h-screen bg-[#03050A] flex items-center justify-center">
        <p className="font-mono text-xs text-cyan-400/70 tracking-[0.3em] uppercase animate-pulse">
          Synchronizing secure enclave handshake…
        </p>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="min-h-screen bg-[#03050A] text-white flex flex-col items-center justify-center px-6 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#00E5FF 1px, transparent 1px), linear-gradient(90deg, #00E5FF 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />
        <div className="relative z-10 max-w-lg w-full text-center space-y-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 shadow-[0_0_48px_rgba(0,229,255,0.15)]">
            <Shield className="w-8 h-8 text-cyan-400" aria-hidden />
          </div>
          <div className="space-y-3">
            <p className="font-mono text-[10px] text-cyan-400/60 uppercase tracking-[0.35em]">
              Unison Operations Intercept
            </p>
            <h1 className="font-[var(--font-grotesk)] text-2xl sm:text-3xl font-bold tracking-tight text-white/95">
              Hardware Biometric Verification Required
            </h1>
            <p className="font-mono text-xs text-white/45 leading-relaxed">
              WebAuthn / FIDO2 platform authenticator (Touch ID, Face ID, or Windows Hello).
              No password dialogs. Session sealed via httpOnly cryptographic cookie.
            </p>
          </div>

          {session.error && (
            <p className="font-mono text-xs text-red-400/90 border border-red-400/20 bg-red-400/5 rounded-lg px-4 py-3">
              {session.error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {session.needsRegistration ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runRegister()}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-mono text-xs font-bold uppercase tracking-widest text-[#03050A] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-all shadow-[0_0_40px_rgba(0,229,255,0.35)]"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Fingerprint className="w-4 h-4" aria-hidden />
                )}
                Register Touch ID
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthenticate()}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-mono text-xs font-bold uppercase tracking-widest text-[#03050A] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-all shadow-[0_0_40px_rgba(0,229,255,0.35)]"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Fingerprint className="w-4 h-4" aria-hidden />
                )}
                Authenticate with Biometrics
              </button>
            )}
          </div>

          <p className="font-mono text-[10px] text-white/25">
            First deploy: register once, then set WEBAUTHN_CREDENTIALS_JSON on Vercel.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
