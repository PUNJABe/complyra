import { getDb } from "@/server/db";
import { HttpError, route, WRITE } from "@/server/http";
import { importStatement } from "@/server/imports";
import { ParseError } from "@/server/parser";
import { notifyNewHighFindings, processOutbox } from "@/server/notify";

export const GET = route({}, async ({ clientId }) =>
  await getDb().prepare("SELECT id, filename, rows_total, rows_imported, rows_duplicate, rows_rejected, errors_json, created_by, created_at FROM imports WHERE client_id = ? ORDER BY created_at DESC LIMIT 100").all(clientId),
);

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Upload the file as multipart form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  const opts = { dayFirst: form.get("dateOrder") !== "mdy", negativeIsDebit: form.get("negatives") === "out" };
  try {
    const result = await importStatement({ clientId, buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, actor: user.email, opts, ip });
    const db = getDb();
    const client = (await db.prepare("SELECT name, currency FROM clients WHERE id = ?").get(clientId)) as { name: string; currency: string };
    await notifyNewHighFindings(clientId, client.name, client.currency, result.analysis.newHigh, db);
    void await processOutbox(db);
    return result;
  } catch (e) {
    if (e instanceof ParseError) throw new HttpError(400, e.message);
    throw e;
  }
});
