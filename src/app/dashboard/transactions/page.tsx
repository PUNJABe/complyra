"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { useApi } from "@/lib/client-api";
import { useMoney } from "@/components/session";
import { Button, Empty, ErrorNote, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";

type Row = { id: string; hash: string; date: string; merchant: string; amountPaise: number; direction: string; employee: string; department: string; category: string; invoiceNo: string; vendorGstin: string; reference: string; flag: string | null };
type Data = { total: number; spendPaise: number; page: number; pageSize: number; rows: Row[]; facets: { categories: string[]; departments: string[]; employees: string[] } };

const FLAG_DOT: Record<string, string> = { high: "bg-high", medium: "bg-med", low: "bg-low" };

export default function Transactions() {
  const { money, exact } = useMoney();
  const [f, setF] = useState({ q: "", category: "", department: "", employee: "", direction: "", from: "", to: "", flagged: "" });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
  Object.entries(f).forEach(([k, v]) => v && qs.set(k, v));
  const { data, error, loading } = useApi<Data>(`/api/transactions?${qs}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Transactions" sub="Every imported line. A coloured dot marks transactions that are part of an open finding." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input placeholder="Search merchant, employee, invoice…" value={f.q} onChange={set("q")} aria-label="Search" className="lg:col-span-2" />
        <Select value={f.category} onChange={set("category")} aria-label="Category"><option value="">All categories</option>{data?.facets.categories.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select value={f.department} onChange={set("department")} aria-label="Department"><option value="">All departments</option>{data?.facets.departments.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select value={f.employee} onChange={set("employee")} aria-label="Employee"><option value="">All employees</option>{data?.facets.employees.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select value={f.direction} onChange={set("direction")} aria-label="Type"><option value="">Spend and credits</option><option value="debit">Spend only</option><option value="credit">Credits only</option></Select>
        <Input type="date" value={f.from} onChange={set("from")} aria-label="From date" />
        <Input type="date" value={f.to} onChange={set("to")} aria-label="To date" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.flagged === "1"} onChange={(e) => { setF({ ...f, flagged: e.target.checked ? "1" : "" }); setPage(1); }} /> Only flagged</label>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Loading />}
      {data && (data.rows.length === 0 ? <Empty title="No transactions match">Change the filters, or import a statement.</Empty> : (
        <>
          <p className="mb-2 text-sm text-muted">{data.total} transactions · spend in this view {money(data.spendPaise)}</p>
          <Table>
            <thead><tr><Th /><Th>Date</Th><Th>Merchant</Th><Th right>Amount</Th><Th>Employee</Th><Th>Department</Th><Th>Category</Th><Th>Invoice</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.direction === "credit" ? "text-muted" : ""}>
                  <Td>{r.flag ? <span className={`mt-1.5 inline-block size-2 rounded-full ${FLAG_DOT[r.flag]}`} title={`${r.flag} severity finding`} aria-label={`${r.flag} severity finding`} /> : null}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{r.date}</Td>
                  <Td>{r.merchant}{r.reference && <span className="block text-xs text-muted">{r.reference}</span>}<span className="block font-mono text-[10px] text-muted" title="SHA-256 transaction hash">{r.hash.slice(0, 12)}…</span></Td>
                  <Td right>{r.direction === "credit" ? "+" : ""}{exact(r.amountPaise)}</Td>
                  <Td>{r.employee || <span className="text-muted">—</span>}</Td><Td>{r.department || <span className="text-muted">—</span>}</Td>
                  <Td>{r.category}</Td><Td mono>{r.invoiceNo}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
            <div className="flex gap-2"><Button variant="secondary" small disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" small disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </>
      ))}
      <p className="mt-6"><a href="/api/export/report" className="inline-flex items-center gap-2 text-sm text-brand underline underline-offset-2"><Download size={14} /> Export everything to Excel</a></p>
    </>
  );
}
