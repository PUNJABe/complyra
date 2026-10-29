"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, BadgeCheck, CircleDollarSign, Download, FileUp, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { api, errorText, useApi } from "@/lib/client-api";
import { formatMoneyCompact } from "@/lib/money";
import { canWrite, useMoney, useSession } from "@/components/session";
import { Button, ErrorNote, Input, Loading, PageHeader } from "@/components/ui";
import { useToast } from "@/components/toast";

type Stats = {
  totals: { spendPaise: number; debitCount: number; creditPaise: number; creditCount: number; firstDate: string | null; lastDate: string | null; imports: number };
  byMonth: { month: string; paise: number }[];
  byCategory: { name: string; paise: number; count: number }[];
  byDepartment: { name: string; paise: number; count: number }[];
  topMerchants: { name: string; paise: number; count: number }[];
  findings: { open: number; confirmed: number; dismissed: number; escalated: number; openBySeverity: { high: number; medium: number; low: number }; flaggedTransactions: number; flaggedSpendPaise: number };
  cleanRate: number | null;
  lastAnalysis: { ranAt: string; skipped: { ruleId: string; ruleName: string; reason: string }[] } | null;
};
type Deadline = { id: string; label: string; dueDate: string; done: boolean; overdue: boolean };

const MONTH = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

function Figure({ label, value, sub, tone, icon: Icon, iconTone }: { label: string; value: string; sub?: string; tone?: string; icon: React.ComponentType<{ size?: number; className?: string }>; iconTone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${tone ?? ""}`}>{value}</p>
        </div>
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${iconTone}`}><Icon size={19} aria-hidden="true" /></div>
      </div>
      {sub && <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Ranked({ title, rows, total }: { title: string; rows: { name: string; paise: number; count: number }[]; total: number }) {
  const { money } = useMoney();
  const max = Math.max(...rows.map((r) => r.paise), 1);
  return (
    <section aria-label={title}>
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex justify-between text-sm"><span className="truncate pr-3">{r.name}</span><span className="tabular-nums">{money(r.paise)} <span className="text-muted">({total ? Math.round((r.paise / total) * 100) : 0}%)</span></span></div>
            <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(r.paise / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Ask() {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(""); setA("");
    try { setA((await api<{ answer: string }>("/api/ask", { method: "POST", json: { question: q } })).answer); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Ask about your data" className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-semibold">Ask about this client&rsquo;s data</h2>
      <p className="mb-3 text-sm text-muted">Answers use only the totals and findings computed above. The AI cannot see raw statements.</p>
      <form onSubmit={go} className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which department spent the most in September?" aria-label="Question" /><Button disabled={busy || q.trim().length < 3}>{busy ? "Thinking…" : "Ask"}</Button></form>
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      {a && <p className="mt-3 whitespace-pre-wrap text-sm">{a}</p>}
    </section>
  );
}

export default function Overview() {
  const { data, error, loading, reload } = useApi<Stats>("/api/dashboard");
  const deadlines = useApi<Deadline[]>("/api/deadlines");
  const { money, currency } = useMoney();
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading || !data) return <Loading />;
  const s = data;

  const rerun = async () => {
    setBusy(true);
    try { const r = await api<{ created: number; removed: number }>("/api/analysis/run", { method: "POST" }); toast(`Checks complete: ${r.created} new, ${r.removed} cleared.`); reload(); }
    catch (e) { toast(errorText(e), "error"); } finally { setBusy(false); }
  };

  if (!s.totals.debitCount && !s.totals.creditCount) {
    return (
      <>
        <PageHeader title="Overview" sub="Your workspace is ready. Start by bringing in a statement." />
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-labelledby="getting-started-title">
          <div className="bg-gradient-to-br from-brand-soft via-surface to-surface px-6 py-8 sm:px-9 sm:py-10">
            <div className="max-w-2xl">
              <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand text-brand-ink shadow-sm"><FileUp size={22} aria-hidden="true" /></div>
              <h2 id="getting-started-title" className="text-xl font-semibold tracking-tight sm:text-2xl">Start with your first statement</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Upload a bank, card, or expense statement. Complyra will map the columns, check transactions against your policies, and show you what needs review.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                {canWrite(session.user.role) ? <Link href="/dashboard/import" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"><FileUp size={16} /> Import a statement <ArrowRight size={15} /></Link> : <Link href="/dashboard/transactions" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm transition hover:opacity-90">View transactions <ArrowRight size={15} /></Link>}
                <a href="/sample/expenses-q2-fy27.csv" download className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-sunken">Download sample file</a>
              </div>
              <p className="mt-3 text-xs text-muted">CSV, Excel (.xlsx), and selectable-text PDF · up to 5 MB</p>
            </div>
          </div>
          <div className="grid divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex gap-3 p-4 sm:p-5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">1</span><div><p className="text-sm font-semibold">Import</p><p className="mt-1 text-xs leading-5 text-muted">Columns are recognised automatically. Preview rejected rows before fixing them.</p></div></div>
            <div className="flex gap-3 p-4 sm:p-5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-med-bg text-sm font-semibold text-med">2</span><div><p className="text-sm font-semibold">Review</p><p className="mt-1 text-xs leading-5 text-muted">Check findings and record a decision with context for your audit trail.</p></div></div>
            <div className="flex gap-3 p-4 sm:p-5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok-bg text-sm font-semibold text-ok">3</span><div><p className="text-sm font-semibold">Export</p><p className="mt-1 text-xs leading-5 text-muted">Download a report with the findings, transactions, and review history.</p></div></div>
          </div>
        </section>
      </>
    );
  }

  const maxMonth = Math.max(...s.byMonth.map((m) => m.paise), 1);
  const sev = s.findings.openBySeverity;
  const upcoming = (deadlines.data ?? []).filter((d) => !d.done).slice(0, 4);

  return (
    <>
      <PageHeader
        title="Overview"
        sub={s.totals.firstDate ? `${s.totals.debitCount} spend transactions from ${s.totals.firstDate} to ${s.totals.lastDate}.` : undefined}
        actions={<>
          {canWrite(session.user.role) && <Button variant="secondary" onClick={rerun} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Re-run checks</Button>}
          <a href="/api/export/report" className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-ink hover:opacity-90"><Download size={14} /> Audit report (.xlsx)</a>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure icon={CircleDollarSign} iconTone="bg-brand-soft text-brand" label="Total spend" value={money(s.totals.spendPaise)} sub={s.totals.creditCount ? `${money(s.totals.creditPaise)} refunds excluded` : `${s.totals.debitCount} spend transactions`} />
        <Figure icon={ShieldAlert} iconTone={sev.high ? "bg-high-bg text-high" : "bg-med-bg text-med"} label="Open findings" value={String(s.findings.open)} sub={`${sev.high} high · ${sev.medium} medium · ${sev.low} low`} tone={sev.high ? "text-high" : ""} />
        <Figure icon={TriangleAlert} iconTone="bg-med-bg text-med" label="Spend in open findings" value={money(s.findings.flaggedSpendPaise)} sub={`${s.findings.flaggedTransactions} transactions to review`} />
        <Figure icon={BadgeCheck} iconTone="bg-ok-bg text-ok" label="Transactions with no flags" value={s.cleanRate === null ? "n/a" : `${s.cleanRate}%`} sub={`${s.findings.confirmed} confirmed · ${s.findings.dismissed} dismissed`} tone="text-ok" />
      </div>

      {s.findings.open > 0 && (
        <p className="mt-4 text-sm"><Link href="/dashboard/findings" className="font-medium text-brand underline underline-offset-2">Review {s.findings.open} open finding{s.findings.open === 1 ? "" : "s"}</Link>{sev.high > 0 && <span className="text-muted"> — start with the {sev.high} high-severity.</span>}</p>
      )}
      {s.lastAnalysis && s.lastAnalysis.skipped.length > 0 && (
        <div className="mt-4 rounded-md border border-med/30 bg-med-bg px-4 py-3 text-sm text-med">
          <p className="font-medium">{s.lastAnalysis.skipped.length} rule{s.lastAnalysis.skipped.length === 1 ? " couldn’t" : "s couldn’t"} run on this data</p>
          <ul className="mt-1 list-disc pl-5">{s.lastAnalysis.skipped.map((k) => <li key={k.ruleId}><strong>{k.ruleName}:</strong> {k.reason}</li>)}</ul>
        </div>
      )}

      <section className="mt-8" aria-label="Monthly spend">
        <h2 className="mb-3 font-semibold">Monthly spend</h2>
        <div className="flex h-44 items-end gap-3 rounded-lg border border-line bg-surface p-4">
          {s.byMonth.map((m) => (
            <div key={m.month} className="flex h-full flex-1 flex-col justify-end text-center" title={`${MONTH(m.month)}: ${money(m.paise)}`}>
              <span className="mb-1 text-xs tabular-nums text-muted">{formatMoneyCompact(m.paise, currency)}</span>
              <div className="bar-grow w-full rounded-t bg-brand" style={{ height: `${Math.max((m.paise / maxMonth) * 100 * 0.78, 2)}%` }} role="img" aria-label={`${MONTH(m.month)} ${money(m.paise)}`} />
              <span className="mt-1.5 text-xs text-muted">{MONTH(m.month)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Ranked title="By category" rows={s.byCategory} total={s.totals.spendPaise} />
        <Ranked title="By department" rows={s.byDepartment} total={s.totals.spendPaise} />
        <Ranked title="Top merchants" rows={s.topMerchants} total={s.totals.spendPaise} />
      </div>

      {upcoming.length > 0 && (
        <section className="mt-8" aria-label="Upcoming deadlines">
          <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">Upcoming filings</h2><Link href="/dashboard/deadlines" className="text-sm text-brand underline underline-offset-2">All deadlines</Link></div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {upcoming.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2.5"><span>{d.label}</span><span className={`tabular-nums ${d.overdue ? "font-semibold text-high" : "text-muted"}`}>{d.overdue ? "Overdue · " : ""}{d.dueDate}</span></li>
            ))}
          </ul>
        </section>
      )}

      {session.aiEnabled && <div className="mt-8"><Ask /></div>}
      {!session.aiEnabled && <p className="mt-8 text-xs text-muted">Optional: set OPENAI_API_KEY to ask questions in plain language and draft rules from your policy document.</p>}
    </>
  );
}
