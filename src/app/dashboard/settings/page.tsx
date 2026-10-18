"use client";
import { useState } from "react";
import { api, errorText, useApi } from "@/lib/client-api";
import { canWrite, useSession } from "@/components/session";
import { Button, ErrorNote, Field, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { useToast } from "@/components/toast";

type User = { id: string; email: string; name: string; role: string; active: number };
type Notif = { channels: { slack: boolean; whatsapp: boolean }; counts: { status: string; n: number }[]; recent: { id: string; channel: string; title: string; status: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string }[] };

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="mb-10"><h2 className="font-semibold">{title}</h2>{sub && <p className="mb-3 mt-0.5 max-w-2xl text-sm text-muted">{sub}</p>}<div className={sub ? "" : "mt-3"}>{children}</div></section>;
}

function ClientForm({ initial, id, onDone }: { initial: { name: string; gstin: string; pan: string; sector: string }; id?: string; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { await api(id ? `/api/clients/${id}` : "/api/clients", { method: id ? "PATCH" : "POST", json: f }); toast(id ? "Client updated." : "Client added with the default rules."); if (!id) setF({ name: "", gstin: "", pan: "", sector: "" }); onDone(); }
    catch (x) { setErr(errorText(x)); }
  };
  return (
    <form onSubmit={save} className="grid max-w-3xl gap-3 sm:grid-cols-2">
      <Field label="Name"><Input required value={f.name} onChange={set("name")} /></Field>
      <Field label="Sector"><Input value={f.sector} onChange={set("sector")} /></Field>
      <Field label="GSTIN" hint="Checked for format and check character."><Input value={f.gstin} onChange={set("gstin")} maxLength={15} className="font-mono" /></Field>
      <Field label="PAN"><Input value={f.pan} onChange={set("pan")} maxLength={10} className="font-mono" /></Field>
      {err && <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>}
      <div><Button>{id ? "Save changes" : "Add client"}</Button></div>
    </form>
  );
}

function Users() {
  const toast = useToast();
  const { data, loading, reload } = useApi<User[]>("/api/users");
  const [f, setF] = useState({ name: "", email: "", password: "", role: "reviewer" });
  const [err, setErr] = useState("");
  const patch = async (u: User, body: object, ok: string) => { try { await api(`/api/users/${u.id}`, { method: "PATCH", json: body }); toast(ok); reload(); } catch (e) { toast(errorText(e), "error"); } };
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { await api("/api/users", { method: "POST", json: f }); setF({ name: "", email: "", password: "", role: "reviewer" }); toast("User created."); reload(); } catch (x) { setErr(errorText(x)); }
  };
  return (
    <>
      {loading && <Loading />}
      {data && (
        <Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id} className={u.active ? "" : "text-muted"}>
              <Td>{u.name}</Td><Td>{u.email}</Td>
              <Td><Select value={u.role} onChange={(e) => patch(u, { role: e.target.value }, "Role updated.")} aria-label={`Role for ${u.email}`} className="!w-auto"><option value="admin">Admin</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></Select></Td>
              <Td>{u.active ? "Active" : "Deactivated"}</Td>
              <Td right><span className="whitespace-nowrap">
                <Button variant="ghost" small onClick={() => { const p = prompt(`New password for ${u.email} (10+ characters, letters and numbers):`); if (p) patch(u, { password: p }, "Password reset."); }}>Reset password</Button>
                <Button variant="ghost" small onClick={() => patch(u, { active: !u.active }, u.active ? "User deactivated." : "User reactivated.")}>{u.active ? "Deactivate" : "Reactivate"}</Button></span></Td>
            </tr>))}</tbody></Table>
      )}
      <form onSubmit={add} className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2">
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Temporary password" hint="10+ characters, letters and numbers."><Input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Role" hint="Reviewers import and review. Viewers are read-only."><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></Select></Field>
        {err && <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>}
        <div><Button>Add user</Button></div>
      </form>
    </>
  );
}

function Notifications({ admin }: { admin: boolean }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<Notif>("/api/notifications");
  const send = async () => { try { const r = await api<{ sent: number; failed: number; dead: number }>("/api/notifications", { method: "POST", json: { action: "test" } }); toast(`Sent ${r.sent}, retrying ${r.failed}, failed ${r.dead}.`); reload(); } catch (e) { toast(errorText(e), "error"); } };
  if (loading || !data) return <Loading />;
  const none = !data.channels.slack && !data.channels.whatsapp;
  return (
    <>
      <p className="mb-3 text-sm">Slack: <strong>{data.channels.slack ? "connected" : "not configured"}</strong> · WhatsApp: <strong>{data.channels.whatsapp ? "connected" : "not configured"}</strong></p>
      {none && <p className="mb-3 max-w-2xl text-sm text-muted">Set SLACK_WEBHOOK_URL (and/or the WHATSAPP_* variables) in your .env file and restart. When an import finds new high-severity issues, a summary is sent. Failed messages retry with increasing delays and are marked failed after five attempts.</p>}
      {admin && !none && <Button variant="secondary" onClick={send}>Send a test message</Button>}
      {data.recent.length > 0 && (
        <div className="mt-4"><Table><thead><tr><Th>When</Th><Th>Channel</Th><Th>Message</Th><Th>Status</Th></tr></thead>
          <tbody>{data.recent.map((r) => <tr key={r.id}><Td className="whitespace-nowrap tabular-nums">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Td><Td>{r.channel}</Td><Td>{r.title}</Td>
            <Td>{r.status}{r.status !== "sent" && ` (${r.attempts}/${r.max_attempts})`}{r.last_error && <span className="block text-xs text-high">{r.last_error}</span>}</Td></tr>)}</tbody></Table></div>
      )}
    </>
  );
}

export default function Settings() {
  const s = useSession();
  const admin = s.user.role === "admin";
  const active = s.clients.find((c) => c.id === s.activeClientId);

  return (
    <>
      <PageHeader title="Settings" />
      {admin && active && <Section title="This client" sub="Details for the client you are currently working on."><ClientForm key={active.id} id={active.id} initial={{ name: active.name, gstin: active.gstin, pan: active.pan, sector: active.sector }} onDone={s.reload} /></Section>}
      {admin && <Section title="Add another client" sub="Each client has its own transactions, rules, findings and deadlines. New clients start with the default rule pack."><ClientForm onDone={s.reload} initial={{ name: "", gstin: "", pan: "", sector: "" }} /></Section>}
      {admin && <Section title="People"><Users /></Section>}
      {canWrite(s.user.role) && <Section title="Notifications"><Notifications admin={admin} /></Section>}
      <Section title="Your account"><p className="text-sm">{s.user.name} · {s.user.email} · <strong>{s.user.role}</strong></p>{!admin && <p className="mt-1 text-sm text-muted">Ask an administrator to change your role or password.</p>}</Section>
    </>
  );
}
