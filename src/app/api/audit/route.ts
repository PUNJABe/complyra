import { listAudit } from "@/server/audit";
import { route, WRITE } from "@/server/http";

export const GET = route({ roles: WRITE }, ({ req, clientId }) => {
  const sp = new URL(req.url).searchParams;
  const rows = listAudit({ limit: 100, beforeSeq: Number(sp.get("before")) || undefined, clientId, action: sp.get("action") || undefined });
  return { rows: rows.map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, action: r.action, resource: r.resource, details: r.details, severity: r.severity, ip: r.ip, hash: r.hash })) };
});
