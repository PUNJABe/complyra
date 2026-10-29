"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFrame, PasswordField } from "@/components/auth-form";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api, errorText } from "@/lib/client-api";

export default function SetupPage() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", password: "", clientName: "", gstin: "", pan: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/api/setup", { method: "POST", json: { ...f, gstin: f.gstin || undefined, pan: f.pan || undefined } });
      router.push("/dashboard"); router.refresh();
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <AuthFrame
      title="Set up your workspace"
      sub="Create the administrator account and your first client. This screen only appears once."
      footer={<>Already have an account? <a href="/login" className="font-medium text-brand hover:underline">Sign in</a></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name"><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>
        <Field label="Email"><Input type="email" required value={f.email} onChange={set("email")} autoComplete="username" /></Field>
        <PasswordField label="Password" hint="At least 10 characters with letters and numbers." value={f.password} onChange={set("password")} autoComplete="new-password" />
        <Field label="Company or client name"><Input required value={f.clientName} onChange={set("clientName")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GSTIN (optional)"><Input value={f.gstin} onChange={set("gstin")} maxLength={15} className="font-mono" /></Field>
          <Field label="PAN (optional)"><Input value={f.pan} onChange={set("pan")} maxLength={10} className="font-mono" /></Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Creating…" : "Create workspace"}</Button>
      </form>
    </AuthFrame>
  );
}
