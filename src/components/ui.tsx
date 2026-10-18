"use client";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

const BTN = {
  primary: "bg-brand text-brand-ink hover:opacity-90",
  secondary: "border border-line bg-surface text-ink hover:bg-sunken",
  ghost: "text-ink hover:bg-sunken",
  danger: "bg-high text-white hover:opacity-90",
} as const;

export function Button({ variant = "primary", small, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN; small?: boolean }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"} ${BTN[variant]} ${className}`}
    />
  );
}

const FIELD = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const Input = (p: ComponentProps<"input">) => <input {...p} className={`${FIELD} ${p.className ?? ""}`} />;
export const Select = (p: ComponentProps<"select">) => <select {...p} className={`${FIELD} ${p.className ?? ""}`} />;
export const Textarea = (p: ComponentProps<"textarea">) => <textarea {...p} className={`${FIELD} ${p.className ?? ""}`} />;

const SEV = {
  high: "bg-high-bg text-high",
  medium: "bg-med-bg text-med",
  low: "bg-low-bg text-low",
} as const;
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${SEV[severity as keyof typeof SEV] ?? SEV.low}`}>{severity}</span>;
}

const STATUS: Record<string, string> = {
  open: "bg-brand-soft text-brand",
  confirmed: "bg-high-bg text-high",
  dismissed: "bg-low-bg text-low",
  escalated: "bg-med-bg text-med",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[status] ?? STATUS.open}`}>{status}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-muted" role="status">{label}…</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-high/30 bg-high-bg px-3 py-2 text-sm text-high" role="alert">{children}</p>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-lg border border-line bg-surface p-5 shadow-2xl`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" small onClick={onClose} aria-label="Close">Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-line bg-surface"><table className="w-full text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th scope="col" className={`border-b border-line bg-sunken px-3 py-2 text-xs font-semibold text-muted ${right ? "text-right" : ""}`}>{children}</th>
);
export const Td = ({ children, right, mono, className = "" }: { children?: ReactNode; right?: boolean; mono?: boolean; className?: string }) => (
  <td className={`border-b border-line px-3 py-2 align-top ${right ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""} ${className}`}>{children}</td>
);
