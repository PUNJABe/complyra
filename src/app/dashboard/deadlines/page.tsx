"use client";
import { useState } from "react";
import { api, errorText, useApi } from "@/lib/client-api";
import { canWrite, useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { useToast } from "@/components/toast";

type D = { id: string; kind: string; label: string; dueDate: string; done: boolean; overdue: boolean };

export default function Deadlines() {
  const session = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<D[]>("/api/deadlines");
  const [f, setF] = useState({ kind: "GST", label: "", dueDate: "" });
  const [err, setErr] = useState("");
  const writer = canWrite(session.user.role);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toast(errorText(e), "error"); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { await api("/api/deadlines", { method: "POST", json: f }); setF({ ...f, label: "", dueDate: "" }); reload(); } catch (x) { setErr(errorText(x)); }
  };

  return (
    <>
      <PageHeader title="Deadlines" sub="Filing dates for the active client. Overdue items are marked in red."
        actions={writer ? <Button variant="secondary" onClick={() => run(async () => { const r = await api<{ added: number }>("/api/deadlines/generate", { method: "POST", json: { months: 3 } }); toast(`Added ${r.added} reminders.`); })}>Add next 3 months of GST and TDS dates</Button> : undefined} />
      <p className="mb-4 max-w-2xl rounded-md bg-sunken px-3 py-2 text-xs text-muted">Generated dates are the standard ones (GSTR-1 on the 11th, GSTR-3B on the 20th, TDS payment on the 7th). Due dates are extended by notification and differ for some filers, such as QRMP, so confirm against the current notification before relying on them.</p>

      {writer && (
        <form onSubmit={add} className="mb-6 grid max-w-3xl gap-3 sm:grid-cols-[110px_1fr_160px_auto] sm:items-end">
          <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option>GST</option><option>TDS</option><option>ITR</option><option value="OTHER">Other</option></Select></Field>
          <Field label="What is due"><Input required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="GSTR-3B for September" /></Field>
          <Field label="Due date"><Input type="date" required value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Button>Add</Button>
        </form>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty title="No deadlines yet">Add one above, or generate the standard monthly GST and TDS dates.</Empty> : (
        <Table>
          <thead><tr><Th>Due</Th><Th>Type</Th><Th>Filing</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id} className={d.done ? "text-muted" : ""}>
                <Td className={`whitespace-nowrap tabular-nums ${d.overdue ? "font-semibold text-high" : ""}`}>{d.dueDate}</Td>
                <Td>{d.kind}</Td><Td>{d.label}</Td>
                <Td>{d.done ? "Filed" : d.overdue ? <span className="font-semibold text-high">Overdue</span> : "Pending"}</Td>
                <Td right>{writer && <span className="whitespace-nowrap"><Button variant="ghost" small onClick={() => run(() => api(`/api/deadlines/${d.id}`, { method: "PATCH", json: { done: !d.done } }))}>{d.done ? "Reopen" : "Mark filed"}</Button><Button variant="ghost" small onClick={() => confirm(`Remove “${d.label}”?`) && run(() => api(`/api/deadlines/${d.id}`, { method: "DELETE" }))}>Remove</Button></span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}
    </>
  );
}
