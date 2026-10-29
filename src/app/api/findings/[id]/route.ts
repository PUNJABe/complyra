import { getDb } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";
import { reviewFinding, reviewSchema } from "@/server/findings";

export const GET = route({}, async ({ clientId, params }) => {
  const db = getDb();
  const f = (await db.prepare("SELECT * FROM findings WHERE id = ? AND client_id = ?").get(params.id, clientId)) as (Record<string, unknown> & { txn_ids_json: string }) | undefined;
  if (!f) throw new HttpError(404, "Finding not found.");
  const ids = (JSON.parse(f.txn_ids_json) as string[]).slice(0, 100);
  const txns = ids.length ? await db.prepare(`SELECT id, txn_date date, merchant, amount_paise amountPaise, direction, employee, department, category, invoice_no invoiceNo, vendor_gstin vendorGstin, reference FROM transactions WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY txn_date`).all(...ids) : [];
  const { txn_ids_json, ...rest } = f;
  void txn_ids_json;
  return { ...rest, transactions: txns };
});

export const PATCH = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const body = reviewSchema.parse(await jsonBody(req));
  await reviewFinding(getDb(), { id: params.id, clientId, status: body.status, note: body.note, actor: user.email, ip });
  return { ok: true };
});
