"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { api, errorText, useApi } from "@/lib/client-api";
import { canWrite, useMoney, useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Input, Loading, PageHeader, Select, SeverityBadge, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { useToast } from "@/components/toast";
import { KIND_META } from "@/lib/rules";

type Item = { id: string; rule_kind: string; rule_name: string; severity: string; title: string; why: string; evidence: string; amount_paise: number; status: string; reviewed_by: string | null; review_note: string | null; reviewed_at: string | null; first_seen_at: string; txnCount: number };
type Txn = { id: string; date: string; merchant: string; amountPaise: number; direction: string; employee: string; category: string; invoiceNo: string };
type Detail = Item & { transactions: Txn[] };

const STATUSES = [["open", "Open"], ["escalated", "Escalated"], ["confirmed", "Confirmed"], ["dismissed", "Dismissed"], ["all", "All"]];
const BAR: Record<string, string> = { high: "border-l-high", medium: "border-l-med", low: "border-l-low" };

export default function Findings() {
  const session = useSession();
  const toast = useToast();
  const { money, exact } = useMoney();
  const writer = canWrite(session.user.role);
  const [f, setF] = useState({ status: "open", severity: "", kind: "", q: "" });
  const [picked, setPicked] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v && qs.set(k, v));
  const list = useApi<Item[]>(`/api/findings?${qs}`);
  const items = useMemo(() => list.data ?? [], [list.data]);
  const activeId = items.some((i) => i.id === picked) ? picked : items[0]?.id ?? null;
  const detail = useApi<Detail>(activeId ? `/api/findings/${activeId}` : null);
  const index = items.findIndex((i) => i.id === activeId);

  const select = useCallback((id: string | null) => { setPicked(id); setNote(""); setErr(""); }, []);
  const move = useCallback((d: number) => { const n = items[index + d]; if (n) select(n.id); }, [items, index, select]);

  const act = useCallback(async (status: "confirmed" | "dismissed" | "escalated" | "open") => {
    if (!activeId || !writer) return;
    if ((status === "dismissed" || status === "escalated") && note.trim().length < 3) {
      setErr(`Add a short note explaining why you are marking this ${status}.`);
      noteRef.current?.focus();
      return;
    }
    setBusy(true); setErr("");
    try {
      await api(`/api/findings/${activeId}`, { method: "PATCH", json: { status, note } });
      const next = items[index + 1] ?? items[index - 1];
      toast(status === "open" ? "Reopened." : `Marked ${status}.`);
      select(f.status === "all" ? activeId : next?.id ?? null);
      list.reload(); detail.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }, [activeId, writer, note, items, index, f.status, toast, select, list, detail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") move(1);
      else if (e.key === "k") move(-1);
      else if (e.key === "c") act("confirmed");
      else if (e.key === "e") act("escalated");
      else if (e.key === "d") act("dismissed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, act]);

  const bulk = async (status: "confirmed" | "dismissed") => {
    if (status === "dismissed" && note.trim().length < 3) { setErr("Add a note to dismiss several findings at once."); noteRef.current?.focus(); return; }
    setBusy(true); setErr("");
    try { await api("/api/findings/bulk", { method: "POST", json: { ids: [...checked], status, note } }); toast(`${checked.size} findings marked ${status}.`); setChecked(new Set()); setNote(""); list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const d = detail.data && detail.data.id === activeId ? detail.data : null;

  return (
    <>
      <PageHeader title="Findings" sub="Work through what the policy engine flagged. Every decision is recorded with your name and note." actions={<a href="/api/export/findings" className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-sunken"><Download size={14} /> CSV</a>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <div role="tablist" aria-label="Status" className="flex rounded-md border border-line bg-surface p-0.5">
          {STATUSES.map(([v, l]) => <button key={v} role="tab" aria-selected={f.status === v} onClick={() => { setF({ ...f, status: v }); setChecked(new Set()); }} className={`rounded px-3 py-1.5 text-sm ${f.status === v ? "bg-brand text-brand-ink" : "text-muted hover:text-ink"}`}>{l}</button>)}
        </div>
        <Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} aria-label="Severity" className="!w-auto"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
        <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Rule type" className="!w-auto"><option value="">Any rule type</option>{Object.values(KIND_META).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</Select>
        <Input placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search findings" className="!w-48" />
      </div>

      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {list.loading && <Loading />}
      {list.data && items.length === 0 && <Empty title={f.status === "open" ? "Nothing left to review" : "No findings match"}>{f.status === "open" ? "Every open finding has a decision. Import more data or adjust your policies to find more." : "Try a different filter."}</Empty>}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <div className="min-w-0">
            {writer && checked.size > 0 && (
              <div className="mb-2 space-y-2 rounded-lg border border-brand/40 bg-brand-soft p-3 text-sm">
                <p className="font-medium">{checked.size} selected</p>
                <div className="flex gap-2"><Button small variant="secondary" disabled={busy} onClick={() => bulk("confirmed")}>Confirm</Button><Button small variant="secondary" disabled={busy} onClick={() => bulk("dismissed")}>Dismiss (needs note)</Button><Button small variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button></div>
              </div>
            )}
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface" aria-label="Findings">
              {items.map((i) => (
                <li key={i.id} className={`flex border-l-4 ${BAR[i.severity]} ${i.id === activeId ? "bg-brand-soft" : ""}`}>
                  {writer && <input type="checkbox" className="ml-3 mt-4" checked={checked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.title}`} />}
                  <button onClick={() => select(i.id)} aria-current={i.id === activeId} className="min-w-0 flex-1 px-3 py-3 text-left">
                    <span className="line-clamp-2 text-sm font-medium">{i.title}</span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate">{i.rule_name}</span><span className="shrink-0 tabular-nums">{money(i.amount_paise)}</span></span>
                    {i.status !== "open" && <span className="mt-1 block"><StatusBadge status={i.status} /></span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{items.length} shown{items.length === 500 ? " (limit reached; filter to see more)" : ""}{writer ? " · keys: J/K move, C confirm, E escalate, D dismiss" : ""}</p>
          </div>

          <section className="min-w-0 rounded-lg border border-line bg-surface p-5" aria-label="Finding detail" aria-live="polite">
            {!d ? <Loading /> : (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2"><SeverityBadge severity={d.severity} /><StatusBadge status={d.status} /><span className="text-xs text-muted">{KIND_META[d.rule_kind as keyof typeof KIND_META]?.label ?? d.rule_kind} · {d.rule_name}</span></div>
                  <h2 className="text-lg font-semibold leading-snug">{d.title}</h2>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{exact(d.amount_paise)} <span className="text-sm font-normal text-muted">at issue</span></p>
                </div>
                <div><h3 className="mb-1 text-sm font-semibold">Why it was flagged</h3><p className="text-sm">{d.why}</p></div>
                <div><h3 className="mb-1 text-sm font-semibold">Evidence</h3><p className="text-sm text-muted">{d.evidence}</p></div>
                {d.transactions.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Transactions involved ({d.txnCount})</h3>
                    <Table><thead><tr><Th>Date</Th><Th>Merchant</Th><Th>Employee</Th><Th right>Amount</Th><Th>Invoice</Th></tr></thead>
                      <tbody>{d.transactions.slice(0, 12).map((t) => <tr key={t.id}><Td className="whitespace-nowrap tabular-nums">{t.date}</Td><Td>{t.merchant}</Td><Td>{t.employee || "—"}</Td><Td right>{exact(t.amountPaise)}</Td><Td mono>{t.invoiceNo}</Td></tr>)}</tbody></Table>
                    {d.txnCount > 12 && <p className="mt-1 text-xs text-muted">Showing 12 of {d.txnCount}. The full list is in the Excel report.</p>}
                  </div>
                )}
                {d.reviewed_by && (
                  <div className="rounded-md bg-sunken p-3 text-sm"><p className="font-medium">{d.status === "open" ? "Previously reviewed" : `${d.status[0].toUpperCase()}${d.status.slice(1)}`} by {d.reviewed_by}{d.reviewed_at ? ` on ${d.reviewed_at.slice(0, 10)}` : ""}</p>{d.review_note && <p className="mt-1 text-muted">{d.review_note}</p>}</div>
                )}
                {writer && (
                  <div className="space-y-3 border-t border-line pt-4">
                    <label className="block"><span className="mb-1 block text-sm font-medium">Note <span className="font-normal text-muted">(required to dismiss or escalate)</span></span>
                      <Textarea ref={noteRef} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved by CFO, ref email 12 Sep" /></label>
                    {err && <ErrorNote>{err}</ErrorNote>}
                    <div className="flex flex-wrap gap-2">
                      {d.status === "open" || d.status === "escalated" ? (<>
                        <Button variant="danger" disabled={busy} onClick={() => act("confirmed")}>Confirm violation</Button>
                        {d.status === "open" && <Button variant="secondary" disabled={busy} onClick={() => act("escalated")}>Escalate</Button>}
                        <Button variant="secondary" disabled={busy} onClick={() => act("dismissed")}>Dismiss</Button>
                      </>) : <Button variant="secondary" disabled={busy} onClick={() => act("open")}>Reopen</Button>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
