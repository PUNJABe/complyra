"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFrame, PasswordField } from "@/components/auth-form";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api, errorText } from "@/lib/client-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/setup").then((r) => r.needsSetup && router.replace("/setup")).catch(() => {});
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/api/auth/login", { method: "POST", json: { email, password } }); router.push("/dashboard"); router.refresh(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <AuthFrame
      title="Sign in"
      sub="Use the account your administrator created for you."
      footer={<>Setting up for the first time? <a href="/setup" className="font-medium text-brand hover:underline">Create a workspace</a></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <PasswordField autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthFrame>
  );
}
