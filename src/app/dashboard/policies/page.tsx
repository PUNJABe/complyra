"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api, errorText, useApi } from "@/lib/client-api";
import { KIND_META, SEVERITIES, type FieldDef, type KindMeta, type RuleInput } from "@/lib/rules";
import { canWrite, useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, SeverityBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { useToast } from "@/components/toast";

type Rule = { id: string; name: string; kind: keyof typeof KIND_META; severity: string; enabled: boolean; params: Record<string, unknown>; openFindings: number };
type Data = { rules: Rule[]; kinds: KindMeta[]; skipped: { ruleId: string; ruleName: string; reason: string }[] };
type Change = { id: string; rule_id: string | null; action: string; rule: { name?: string; kind?: string; severity?: string }; requested_by: string; status: string; reviewed_by: string | null; review_note: string | null; created_at: string };
type Version = { rule_id: string; rule_name: string; version: number; change_type: string; actor: string; created_at: string };

const toForm = (fields: FieldDef[], p: Record<string, unknown>) =>
  Object.fromEntries(fields.map((f) => [f.key, f.type === "list" ? ((p[f.key] as string[] | undefined) ?? []).join(", ") : f.type === "bool" ? Boolean(p[f.key]) : String(p[f.key] ?? "")]));

function fromForm(fields: FieldDef[], v: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = v[f.key];
    if (f.type === "money" || f.type === "number") out[f.key] = raw === "" ? undefined : Number(raw);
    else if (f.type === "list") out[f.key] = String(raw).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    else out[f.key] = raw;
  }
  return out;
}

function summary(r: { kind: keyof typeof KIND_META; params: Record<string, unknown> }) {
  const fields = KIND_META[r.kind].fields;
  return fields.map((f) => {
    const v = r.params[f.key];
    if (Array.isArray(v)) return v.length ? `${f.label}: ${v.join(", ")}` : null;
    if (v === "" || v === undefined) return null;
    if (f.type === "bool") return v ? f.label : null;
    return `${f.label}: ${f.type === "money" ? `₹${Number(v).toLocaleString("en-IN")}` : String(v)}`;
  }).filter(Boolean).join(" · ") || "No settings";
}

function RuleEditor({ rule, kinds, onClose, onSaved }: { rule: Rule | null; kinds: KindMeta[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [kind, setKind] = useState<keyof typeof KIND_META>(rule?.kind ?? "amount_over");
  const meta = KIND_META[kind];
  const [name, setName] = useState(rule?.name ?? "");
  const [severity, setSeverity] = useState(rule?.severity ?? "medium");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [vals, setVals] = useState<Record<string, string | boolean>>(toForm(meta.fields, rule?.params ?? meta.defaults));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const changeKind = (k: keyof typeof KIND_META) => { setKind(k); setVals(toForm(KIND_META[k].fields, KIND_META[k].defaults)); if (!name) setName(KIND_META[k].label); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const body = { name: name || meta.label, kind, severity, enabled, params: fromForm(meta.fields, vals) };
      const r = await api<{ pendingApproval?: boolean; analysis?: { created: number; removed: number } }>(rule ? `/api/rules/${rule.id}` : "/api/rules", { method: rule ? "PUT" : "POST", json: body });
      onSaved(r.pendingApproval ? "Change submitted for admin approval." : `Saved. Re-checked all transactions: ${r.analysis?.created ?? 0} new, ${r.analysis?.removed ?? 0} cleared.`);
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  };

  return (
    <Modal title={rule ? "Edit rule" : "New rule"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <Field label="Rule type" hint={meta.description}>
          <Select value={kind} onChange={(e) => changeKind(e.target.value as keyof typeof KIND_META)} disabled={Boolean(rule)}>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</Select>
        </Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value)}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rule is active</label>
        </div>
        {meta.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.type === "list" ? `${f.help ?? ""} Separate with commas.`.trim() : f.type === "money" ? "In rupees." : f.help}>
            {f.type === "select" ? <Select value={String(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              : f.type === "bool" ? <span className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })} /> Yes</span>
              : f.type === "list" ? <Textarea rows={2} value={String(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
              : <Input type={f.type === "text" ? "text" : "number"} step="any" min={0} value={String(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
          </Field>
        ))}
        {err && <ErrorNote>{err}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save and re-check"}</Button></div>
      </form>
    </Modal>
  );
}

function AiDraft({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const session = useSession();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<RuleInput[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const draft = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ rules: RuleInput[]; rejected: unknown[] }>("/api/rules/generate", { method: "POST", json: { policyText: text } });
      setDrafts(r.rules); setSkipped(r.rejected.length); setPick(new Set(r.rules.map((_, i) => i)));
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const add = async () => {
    setBusy(true); setErr("");
    try { for (const i of [...pick]) await api("/api/rules", { method: "POST", json: drafts![i] }); onSaved(session.user.role === "admin" ? `Added ${pick.size} rule${pick.size === 1 ? "" : "s"}.` : `Submitted ${pick.size} rule${pick.size === 1 ? "" : "s"} for admin approval.`); }
    catch (e) { setErr(errorText(e)); setBusy(false); }
  };

  return (
    <Modal title="Draft rules from your policy" onClose={onClose} wide>
      {!drafts ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Paste the relevant part of your expense policy. The AI proposes rules using only the rule types Complyra can enforce; nothing is saved until you review it.</p>
          <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Any single expense above ₹40,000 needs CFO approval. Alcohol is not reimbursable. Meals are capped at ₹1,500 per person…" />
          {err && <ErrorNote>{err}</ErrorNote>}
          <div className="flex justify-end"><Button onClick={draft} disabled={busy || text.trim().length < 20}>{busy ? "Drafting…" : "Draft rules"}</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.length === 0 ? <p className="text-sm">No enforceable rules were found in that text.</p> : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {drafts.map((r, i) => (
                <li key={i} className="flex gap-3 p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={pick.has(i)} onChange={() => setPick((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-label={`Include ${r.name}`} />
                  <div><p className="font-medium">{r.name} <SeverityBadge severity={r.severity} /></p><p className="text-muted">{KIND_META[r.kind].label} · {summary({ kind: r.kind, params: r.params as Record<string, unknown> })}</p></div>
                </li>
              ))}
            </ul>
          )}
          {skipped > 0 && <p className="text-xs text-muted">{skipped} suggestion{skipped === 1 ? " was" : "s were"} discarded because they didn’t fit a supported rule type.</p>}
          {err && <ErrorNote>{err}</ErrorNote>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDrafts(null)}>Back</Button><Button onClick={add} disabled={busy || pick.size === 0}>{busy ? "Adding…" : `Add ${pick.size} rule${pick.size === 1 ? "" : "s"}`}</Button></div>
        </div>
      )}
    </Modal>
  );
}

export default function Policies() {
  const session = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/rules");
  const changes = useApi<Change[]>("/api/policies/changes");
  const versions = useApi<Version[]>("/api/policies/versions");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [ai, setAi] = useState(false);
  const writer = canWrite(session.user.role);
  const admin = session.user.role === "admin";

  const toggle = async (r: Rule) => {
    try { const res = await api<{ pendingApproval?: boolean }>(`/api/rules/${r.id}`, { method: "PUT", json: { name: r.name, kind: r.kind, severity: r.severity, enabled: !r.enabled, params: r.params } }); toast(res.pendingApproval ? "Policy change sent for admin approval." : "Policy updated."); reload(); changes.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  };
  const remove = async (r: Rule) => {
    if (!confirm(`Delete “${r.name}”? Its open findings are cleared; reviewed ones are kept as history.`)) return;
    try { const res = await api<{ pendingApproval?: boolean }>(`/api/rules/${r.id}`, { method: "DELETE" }); toast(res.pendingApproval ? "Deletion request sent for admin approval." : "Rule deleted."); reload(); changes.reload(); versions.reload(); } catch (e) { toast(errorText(e), "error"); }
  };
  const reviewChange = async (change: Change, decision: "approve" | "reject") => {
    const note = decision === "reject" ? (window.prompt("Why are you rejecting this policy change? (required)") ?? "") : "";
    if (decision === "reject" && note.trim().length < 3) return;
    try { await api("/api/policies/changes", { method: "PATCH", json: { id: change.id, decision, note } }); toast(decision === "approve" ? "Policy change approved and applied." : "Policy change rejected."); changes.reload(); versions.reload(); reload(); }
    catch (e) { toast(errorText(e), "error"); }
  };

  return (
    <>
      <PageHeader title="Policies" sub="Each rule is checked against every transaction. Saving a rule re-runs all checks immediately."
        actions={writer ? <>{session.aiEnabled && <Button variant="secondary" onClick={() => setAi(true)}><Sparkles size={14} /> Draft from policy text</Button>}<Button onClick={() => setEditing("new")}>New rule</Button></> : undefined} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {changes.data && (admin ? changes.data.filter((c) => c.status === "pending") : changes.data.filter((c) => c.requested_by === session.user.email)).length > 0 && <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="font-semibold">{admin ? "Policy changes awaiting approval" : "Your policy change requests"}</h2>
        <ul className="mt-3 divide-y divide-line">{(admin ? changes.data.filter((c) => c.status === "pending") : changes.data.filter((c) => c.requested_by === session.user.email)).map((change) => <li key={change.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-medium">{change.action}: {change.rule?.name ?? change.rule_id}</p><p className="text-xs text-muted">Requested by {change.requested_by} · {new Date(change.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{!admin && ` · ${change.status}`}</p></div>
          {admin && <div className="flex gap-2"><Button small onClick={() => reviewChange(change,"approve")}>Approve</Button><Button small variant="secondary" onClick={() => reviewChange(change,"reject")}>Reject</Button></div>}
        </li>)}</ul>
      </section>}
      {loading && <Loading />}
      {data && data.skipped.length > 0 && (
        <div className="mb-4 rounded-md border border-med/30 bg-med-bg px-4 py-3 text-sm text-med">
          <p className="font-medium">Rules that couldn’t run on your current data</p>
          <ul className="mt-1 list-disc pl-5">{data.skipped.map((k) => <li key={k.ruleId}><strong>{k.ruleName}:</strong> {k.reason}</li>)}</ul>
        </div>
      )}
      {data && (data.rules.length === 0 ? <Empty title="No rules yet">Add a rule to start checking transactions.</Empty> : (
        <Table>
          <thead><tr><Th>Rule</Th><Th>Settings</Th><Th>Severity</Th><Th right>Open</Th><Th>Active</Th><Th /></tr></thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.id} className={r.enabled ? "" : "text-muted"}>
                <Td><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{KIND_META[r.kind]?.label}</span></Td>
                <Td className="max-w-md text-xs">{summary(r)}</Td>
                <Td><SeverityBadge severity={r.severity} /></Td>
                <Td right>{r.openFindings}</Td>
                <Td><input type="checkbox" checked={r.enabled} disabled={!writer} onChange={() => toggle(r)} aria-label={`${r.name} active`} /></Td>
                <Td right>{writer && <span className="whitespace-nowrap"><Button variant="ghost" small onClick={() => setEditing(r)}>Edit</Button><Button variant="ghost" small onClick={() => remove(r)}>Delete</Button></span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}
      {versions.data && versions.data.length > 0 && <details className="mt-6 rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer text-sm font-semibold">Policy change history <span className="font-normal text-muted">({versions.data.length} recent)</span></summary><div className="mt-3"><Table><thead><tr><Th>Policy</Th><Th>Change</Th><Th>By</Th><Th>When</Th></tr></thead><tbody>{versions.data.map((v) => <tr key={`${v.rule_id}-${v.version}`}><Td>{v.rule_name} <span className="text-xs text-muted">v{v.version}</span></Td><Td>{v.change_type}</Td><Td>{v.actor}</Td><Td>{new Date(v.created_at).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" })}</Td></tr>)}</tbody></Table></div></details>}
      {editing && data && <RuleEditor rule={editing === "new" ? null : editing} kinds={data.kinds} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); reload(); }} />}
      {ai && <AiDraft onClose={() => setAi(false)} onSaved={(m) => { setAi(false); toast(m); reload(); }} />}
    </>
  );
}
