"use client";
import Link from "next/link";
import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Input } from "@/components/ui";

export function AuthFrame({ title, sub, children, footer }: { title: string; sub: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <Link href="/login" className="mb-8 inline-block text-lg font-semibold tracking-tight">Complyra</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-muted">{sub}</p>
        {children}
        {footer && <div className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}

export function PasswordField({
  label = "Password",
  hint,
  value,
  onChange,
  autoComplete,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <span className="relative block">
        <Input type={visible ? "text" : "password"} required value={value} onChange={onChange} autoComplete={autoComplete} className="pr-16" />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-muted hover:text-ink"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
