"use client";
import { useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { api, errorText, useApi } from "@/lib/client-api";
import { Button, Empty, ErrorNote, Loading, PageHeader, Table, Td, Th } from "@/components/ui";

type Row = { seq: number; ts: string; actor: string; action: string; resource: string; details: string; severity: string; hash: string };
type Verify = { ok: true; entries: number; head: string } | { ok: false; entries: number; brokenAtSeq: number; reason: string };

export default function Audit() {
  const first = useApi<{ rows: Row[] }>("/api/audit");
  const [older, setOlder] = useState<Row[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = [...(first.data?.rows ?? []), ...older];

  const check = async () => { setBusy(true); setErr(""); try { setVerify(await api<Verify>("/api/audit/verify")); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const more = async () => {
    const last = rows[rows.length - 1];
    try { const r = await api<{ rows: Row[] }>(`/api/audit?before=${last.seq}`); setOlder([...older, ...r.rows]); } catch (e) { setErr(errorText(e)); }
  };

  return (
    <>
      <PageHeader title="Audit log" sub="An append-only record of sign-ins, imports, rule changes and every review decision. Entries are chained with hashes so edits to history can be detected."
        actions={<Button variant="secondary" onClick={check} disabled={busy}>{busy ? "Verifying…" : "Verify integrity"}</Button>} />
      {verify && (verify.ok ? (
        <div className="mb-4 flex gap-3 rounded-md border border-ok/30 bg-ok-bg px-4 py-3 text-sm text-ok"><ShieldCheck size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-medium">Chain intact: {verify.entries} entries verified.</p><p className="mt-1 break-all font-mono text-xs">Head hash {verify.head}</p><p className="mt-1 text-xs">Record this hash somewhere outside this server (it is also in the Excel report). A later check that no longer contains it means the tail was altered.</p></div></div>
      ) : (
        <div className="mb-4 flex gap-3 rounded-md border border-high/30 bg-high-bg px-4 py-3 text-sm text-high"><ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-medium">Chain broken at entry #{verify.brokenAtSeq}.</p><p className="mt-1">{verify.reason}</p></div></div>
      ))}
      {err && <ErrorNote>{err}</ErrorNote>}
      {first.loading && <Loading />}
      {first.data && (rows.length === 0 ? <Empty title="No activity yet" /> : (
        <>
          <Table>
            <thead><tr><Th>#</Th><Th>Time</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq} className={r.severity === "warning" ? "bg-med-bg/40" : ""}>
                  <Td mono>{r.seq}</Td><Td className="whitespace-nowrap tabular-nums">{new Date(r.ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" })}</Td>
                  <Td>{r.actor}</Td><Td mono>{r.action}</Td><Td>{r.details}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length >= 100 && <div className="mt-3"><Button variant="secondary" small onClick={more}>Load older entries</Button></div>}
        </>
      ))}
    </>
  );
}
