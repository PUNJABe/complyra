"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BookCheck, CalendarClock, FileUp, Gauge, LogOut, Menu, Moon, ScrollText, Settings, ShieldAlert, ShieldCheck, Sun, TableProperties } from "lucide-react";
import { api, useApi, errorText } from "@/lib/client-api";
import { canWrite, SessionContext, type SessionData } from "./session";
import { Loading, ErrorNote, Select } from "./ui";
import { useToast } from "./toast";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/import", label: "Import", icon: FileUp },
  { href: "/dashboard/transactions", label: "Transactions", icon: TableProperties },
  { href: "/dashboard/findings", label: "Findings", icon: ShieldAlert },
  { href: "/dashboard/policies", label: "Policies", icon: BookCheck },
  { href: "/dashboard/deadlines", label: "Deadlines", icon: CalendarClock },
  { href: "/dashboard/audit", label: "Audit log", icon: ScrollText, write: true },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("complyra-theme", next); } catch { /* storage unavailable */ }
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload } = useApi<SessionData>("/api/auth/session");
  const [open, setOpen] = useState(false);

  if (error) return <div className="mx-auto max-w-md p-8"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return <Loading label="Loading workspace" />;

  const switchClient = async (id: string) => {
    try { await api("/api/clients/active", { method: "POST", json: { clientId: id } }); window.location.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  };
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); router.push("/login"); router.refresh(); };
  const items = NAV.filter((n) => !("write" in n) || canWrite(data.user.role));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/dashboard" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${active ? "border-brand bg-brand-soft font-semibold text-brand" : "border-transparent text-muted hover:bg-sunken hover:text-ink"}`}>
            <Icon size={16} aria-hidden /> {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <SessionContext.Provider value={{ ...data, reload }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 shadow-sm lg:hidden">
          <span className="flex items-center gap-2 font-semibold tracking-tight"><span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-ink"><ShieldCheck size={17} /></span>Complyra</span>
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Menu size={20} /></button>
        </header>
        <aside className={`${open ? "block" : "hidden"} border-r border-line bg-surface p-4 shadow-sm lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between`}>
          <div className="space-y-5">
            <div className="hidden items-center gap-2 px-3 lg:flex">
              <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm"><ShieldCheck size={19} /></span>
              <div><p className="text-base font-semibold tracking-tight">Complyra</p><p className="text-[11px] text-muted">Compliance workspace</p></div>
            </div>
            {data.clients.length > 0 && (
              <label className="block px-1">
                <span className="mb-1 block px-2 text-xs text-muted">Client</span>
                <Select value={data.activeClientId ?? ""} onChange={(e) => switchClient(e.target.value)} aria-label="Active client">
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </label>
            )}
            {nav}
          </div>
          <div className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
            <div className="px-3">
              <p className="truncate font-medium">{data.user.name}</p>
              <p className="truncate text-xs text-muted">{data.user.email} · {data.user.role}</p>
            </div>
            <div className="flex gap-1">
              <button onClick={toggleTheme} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label="Toggle dark mode">
                <Sun size={15} className="hidden dark:block" /><Moon size={15} /> Theme
              </button>
              <button onClick={logout} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><LogOut size={15} /> Sign out</button>
            </div>
          </div>
        </aside>
        <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8"><div className="mx-auto max-w-[1180px]">{children}</div></main>
      </div>
    </SessionContext.Provider>
  );
}
