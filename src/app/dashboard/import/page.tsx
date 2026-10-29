"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, UploadCloud, X } from "lucide-react";
import { api, errorText, useApi } from "@/lib/client-api";
import { canWrite, useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { useToast } from "@/components/toast";

type Result = {
  filename: string; rowsTotal: number; imported: number; duplicates: number; rejected: number; credits: number;
  mapping: Record<string, string>; rejectedRows: { line: number; reason: string }[];
  analysis: { detections: number; created: number; removed: number; newHigh: unknown[]; skipped: { ruleId: string; ruleName: string; reason: string }[] };
};
type ImportRow = { id: string; filename: string; rows_total: number; rows_imported: number; rows_duplicate: number; rows_rejected: number; created_by: string; created_at: string };
type Template = { id: string; name: string; options: { dateOrder: string; negatives: string; columnMapping?: Record<string, string> } };
type Preview = { totalRows: number; accepted: number; rejected: number; ignored: number; mapping: Record<string, string>; headers: string[]; sample: { date: string; merchant: string; amountPaise: number; direction: string; category: string }[]; rejectedRows: { line: number; reason: string }[] };

const FIELD_LABEL: Record<string, string> = {
  date: "Date", merchant: "Merchant", amount: "Amount", debit: "Debit", credit: "Credit", type: "Type", employee: "Employee",
  department: "Department", category: "Category", invoice: "Invoice no.", gstin: "Vendor GSTIN", reference: "Reference",
};

export default function ImportPage() {
  const session = useSession();
  const toast = useToast();
  const history = useApi<ImportRow[]>("/api/imports");
  const templates = useApi<Template[]>("/api/imports/templates");
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dateOrder, setDateOrder] = useState("dmy");
  const [negatives, setNegatives] = useState("refund");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [dragging, setDragging] = useState(false);
  const writer = canWrite(session.user.role);

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    const lower = next.name.toLowerCase();
    const supported = [".csv", ".xlsx", ".pdf", ".txt"].some((ext) => lower.endsWith(ext));
    if (!supported) { setError("Choose a CSV, .xlsx, text-based PDF, or .txt statement."); setFile(null); setPreview(null); if (input.current) input.current.value = ""; return; }
    if (next.size > 5 * 1024 * 1024) { setError("This file is larger than 5 MB. Split it and try again."); setFile(null); setPreview(null); if (input.current) input.current.value = ""; return; }
    setError("");
    setFile(next);
    setPreview(null);
    setHeaders([]); setColumnMapping({});
  };

  const fileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !preview) return;
    setBusy(true); setError(""); setResult(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("dateOrder", dateOrder); fd.append("negatives", negatives); fd.append("columnMapping", JSON.stringify(columnMapping));
    try {
      const r = await api<Result>("/api/imports", { method: "POST", body: fd });
      setResult(r); setFile(null); if (input.current) input.current.value = ""; history.reload();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const previewFile = async () => {
    if (!file) return;
    setBusy(true); setError(""); setPreview(null);
    const fd = new FormData(); fd.append("file", file); fd.append("dateOrder", dateOrder); fd.append("negatives", negatives); fd.append("columnMapping", JSON.stringify(columnMapping));
    try { const r = await api<Preview>("/api/imports/preview", { method: "POST", body: fd }); setPreview(r); setHeaders(r.headers); setColumnMapping({ ...columnMapping, ...r.mapping }); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const saveTemplate = async () => {
    try {
      await api("/api/imports/templates", { method: "POST", json: { name: templateName, dateOrder, negatives, columnMapping } });
      setTemplateName(""); templates.reload(); toast("Import setup saved.");
    } catch (err) { toast(errorText(err), "error"); }
  };

  const remove = async (row: ImportRow) => {
    if (!confirm(`Remove ${row.filename} and its ${row.rows_imported} transactions? Open findings that depend on them will be cleared. This is recorded in the audit log.`)) return;
    try { await api(`/api/imports/${row.id}`, { method: "DELETE" }); toast("Import removed."); history.reload(); }
    catch (err) { toast(errorText(err), "error"); }
  };

  const applyTemplate = (id: string) => {
    const template = templates.data?.find((item) => item.id === id);
    if (!template) return;
    setDateOrder(template.options.dateOrder); setNegatives(template.options.negatives); setColumnMapping(template.options.columnMapping ?? {}); setPreview(null);
  };

  return (
    <>
      <PageHeader title="Import" sub="Upload a bank, card or expense statement as CSV, Excel (.xlsx), or a text-based PDF. Every row is checked against your policies straight away." />

      {writer ? (
        <form onSubmit={upload} className="max-w-3xl space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="statement-file" className="text-sm font-semibold">Statement file</label>
              <span className="text-xs text-muted">Up to 5 MB · 20,000 rows</span>
            </div>
            <input ref={input} id="statement-file" type="file" accept=".csv,.xlsx,.pdf,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,text/plain" onChange={(e) => chooseFile(e.target.files?.[0])} className="sr-only" />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}
              className={`rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors sm:py-9 ${dragging ? "border-brand bg-brand-soft/70" : "border-line bg-canvas/60 hover:border-brand/50 hover:bg-brand-soft/30"}`}
            >
              {file ? (
                <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-sm">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    {file.name.toLowerCase().endsWith(".pdf") ? <FileText size={20} /> : <FileSpreadsheet size={20} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                    <p className="text-xs text-muted">{fileSize(file.size)} · Ready to import</p>
                  </div>
                  <button type="button" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label="Remove selected file" title="Remove file">
                    <X size={17} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand"><UploadCloud size={23} aria-hidden="true" /></div>
                  <p className="mt-3 text-sm font-semibold">Drop your statement here</p>
                  <p className="mt-1 text-sm text-muted">or choose a file from your device</p>
                  <Button type="button" variant="secondary" className="mt-4" onClick={() => input.current?.click()}>Browse files</Button>
                  <div className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Supported file types">
                    {["CSV", "Excel · XLSX", "Text PDF", "TXT"].map((format) => <span key={format} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted">{format}</span>)}
                  </div>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">Columns are recognised automatically. Scanned PDFs need selectable text; image-only PDFs aren’t OCR’d.</p>
          </div>
          <div className="grid gap-4 rounded-xl bg-sunken/50 p-4 sm:grid-cols-2">
            <Field label="Date format" hint="Decides what 03/04/2026 means.">
              <Select value={dateOrder} onChange={(e) => { setDateOrder(e.target.value); setPreview(null); }}>
                <option value="dmy">Day first: 3 April (India)</option>
                <option value="mdy">Month first: 4 March (US)</option>
              </Select>
            </Field>
            <Field label="Negative amounts are" hint="Only matters for a single signed Amount column.">
              <Select value={negatives} onChange={(e) => { setNegatives(e.target.value); setPreview(null); }}>
                <option value="refund">Refunds or credits (cards, expense reports)</option>
                <option value="out">Payments going out (bank statements)</option>
              </Select>
            </Field>
          </div>
          {templates.data && templates.data.length > 0 && <Field label="Saved import setup" hint="Reuses your column mapping, date format, and signed amount preference.">
            <Select defaultValue="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Choose a saved setup…</option>{templates.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Save these settings and mapping"><Input value={templateName} maxLength={60} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Company card statements" /></Field>
            <Button type="button" variant="secondary" disabled={templateName.trim().length < 2} onClick={saveTemplate}>Save setup</Button>
            <Button type="button" variant="secondary" disabled={!file || busy} onClick={previewFile}>{busy ? "Reading…" : "Preview file"}</Button>
          </div>
          {preview && <div className="space-y-3 rounded-xl border border-line bg-canvas/60 p-4">
            <div><p className="text-sm font-semibold">Preview: {preview.accepted} rows ready</p><p className="text-xs text-muted">{preview.totalRows} rows found · {preview.rejected} need attention · {preview.ignored} summary rows ignored</p></div>
            <p className="text-xs text-muted">{Object.entries(preview.mapping).map(([k,v]) => `${FIELD_LABEL[k] ?? k} ← “${v}”`).join(" · ")}</p>
            {preview.sample.length > 0 && <Table><thead><tr><Th>Date</Th><Th>Merchant</Th><Th>Category</Th><Th right>Amount</Th></tr></thead><tbody>{preview.sample.map((r,i) => <tr key={`${r.date}-${i}`}><Td>{r.date}</Td><Td>{r.merchant}</Td><Td>{r.category}</Td><Td right>{r.direction === "credit" ? "Credit · " : ""}{(r.amountPaise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })}</Td></tr>)}</tbody></Table>}
            {preview.rejectedRows.length > 0 && <p className="text-xs text-med">First issue: row {preview.rejectedRows[0].line} — {preview.rejectedRows[0].reason}</p>}
          </div>}
          {headers.length > 0 && <div className="rounded-xl border border-line bg-canvas/60 p-4">
            <div className="mb-3"><p className="text-sm font-semibold">Match your columns</p><p className="text-xs text-muted">Choose which file column supplies each field. Preview again after changing a match.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{Object.entries(FIELD_LABEL).map(([field,label]) => <Field key={field} label={label}><Select value={columnMapping[field] ?? ""} onChange={(e) => { setColumnMapping({ ...columnMapping, [field]: e.target.value }); setPreview(null); }}><option value="">Not included</option>{headers.map((header,i) => <option key={`${i}-${header}`} value={header}>{header}</option>)}</Select></Field>)}</div>
          </div>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-muted">Your original file is only used to read the statement rows.</p>
            <div className="flex flex-wrap items-center gap-3">
            <a href="/sample/expenses-q2-fy27.csv" download className="text-sm text-brand underline underline-offset-2">Download a sample statement</a>
              <Button disabled={!file || !preview || busy}>{busy ? "Importing and checking…" : "Import and check"}</Button>
            </div>
          </div>
        </form>
      ) : <ErrorNote>Your role is read-only, so you can’t import statements.</ErrorNote>}

      {result && (
        <section className="mt-6 max-w-3xl space-y-4" aria-label="Import result">
          <div className="rounded-lg border border-ok/30 bg-ok-bg p-5">
            <p className="font-semibold text-ok">Imported {result.imported} transactions from {result.filename}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {result.duplicates > 0 && <li>{result.duplicates} rows were already on file and were skipped, so nothing is double counted.</li>}
              {result.credits > 0 && <li>{result.credits} refund or credit row{result.credits === 1 ? "" : "s"} recorded but excluded from spend.</li>}
              {result.rejected > 0 && <li>{result.rejected} row{result.rejected === 1 ? "" : "s"} could not be read (listed below).</li>}
              <li>Policy check: {result.analysis.created} new finding{result.analysis.created === 1 ? "" : "s"}{result.analysis.newHigh.length ? `, ${result.analysis.newHigh.length} high severity` : ""}.{" "}
                <Link href="/dashboard/findings" className="font-medium underline underline-offset-2">Review findings</Link></li>
            </ul>
          </div>
          {result.analysis.skipped.length > 0 && (
            <div className="rounded-md border border-med/30 bg-med-bg px-4 py-3 text-sm text-med">
              <p className="font-medium">Some rules couldn’t run on this file</p>
              <ul className="mt-1 list-disc pl-5">{result.analysis.skipped.map((k) => <li key={k.ruleId}><strong>{k.ruleName}:</strong> {k.reason}</li>)}</ul>
            </div>
          )}
          <div>
            <h2 className="mb-2 text-sm font-semibold">How we read your columns</h2>
            <p className="text-sm text-muted">{Object.entries(result.mapping).map(([k, v]) => `${FIELD_LABEL[k] ?? k} ← “${v}”`).join("  ·  ")}</p>
          </div>
          {result.rejectedRows.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">Rows that were not imported</h2>
              <Table><thead><tr><Th>File row</Th><Th>Reason</Th></tr></thead>
                <tbody>{result.rejectedRows.map((r) => <tr key={r.line}><Td mono>{r.line}</Td><Td>{r.reason}</Td></tr>)}</tbody></Table>
              <p className="mt-2 text-xs text-muted">Fix these in the file and import again. Rows already on file are skipped automatically.</p>
            </div>
          )}
        </section>
      )}

      <h2 className="mb-3 mt-10 font-semibold">Import history</h2>
      {history.loading ? <Loading /> : !history.data?.length ? <Empty title="Nothing imported yet">Your imported statements and row counts will appear here after your first upload.</Empty> : (
        <Table>
          <thead><tr><Th>File</Th><Th>When</Th><Th>By</Th><Th right>Imported</Th><Th right>Skipped</Th><Th right>Rejected</Th><Th /></tr></thead>
          <tbody>
            {history.data.map((r) => (
              <tr key={r.id}>
                <Td>{r.filename}</Td><Td className="whitespace-nowrap tabular-nums">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Td>
                <Td>{r.created_by}</Td><Td right>{r.rows_imported}</Td><Td right>{r.rows_duplicate}</Td><Td right>{r.rows_rejected}</Td>
                <Td right>{session.user.role === "admin" && <Button variant="ghost" small onClick={() => remove(r)}>Remove</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
