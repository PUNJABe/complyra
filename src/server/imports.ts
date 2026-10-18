import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { audit } from "./audit";
import { getDb, newId, nowIso } from "./db";
import { MAX_FILE_BYTES, ParseError, parseStatement, type ParseOptions } from "./parser";
import { runAnalysis, type AnalysisSummary } from "./analysis";
import { transactionHash } from "./transaction-hash";

export type ImportResult = {
  importId: string;
  filename: string;
  rowsTotal: number;
  imported: number;
  duplicates: number;
  rejected: number;
  credits: number;
  mapping: Record<string, string>;
  rejectedRows: { line: number; reason: string }[];
  analysis: AnalysisSummary;
};

/**
 * Idempotent import: each row gets a content hash (plus its occurrence index inside the file, so two genuinely
 * identical purchases on one day are both kept). Re-uploading the same or an overlapping statement skips rows
 * already stored instead of double counting.
 */
export async function importStatement(args: {
  clientId: string; buffer: Buffer; filename: string; actor: string; opts: ParseOptions; ip?: string;
}, db: Database.Database = getDb()): Promise<ImportResult> {
  const { clientId, buffer, filename, actor, opts } = args;
  if (buffer.length === 0) throw new ParseError("The file is empty.");
  if (buffer.length > MAX_FILE_BYTES) throw new ParseError("File is larger than 5 MB. Split it and import in parts.");

  const parsed = await parseStatement(buffer, filename, opts);
  if (!parsed.rows.length) {
    const why = parsed.rejected.slice(0, 3).map((r) => `row ${r.line}: ${r.reason}`).join("; ");
    throw new ParseError(`No valid transactions found.${why ? " " + why : ""}`);
  }

  const importId = newId();
  const now = nowIso();
  const seen = new Map<string, number>();
  let imported = 0;
  let duplicates = 0;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO imports (id, client_id, filename, file_sha256, rows_total, rows_imported, rows_duplicate, rows_rejected, errors_json, created_by, created_at)
       VALUES (?,?,?,?,?,0,0,?,?,?,?)`,
    ).run(importId, clientId, filename.slice(0, 200), createHash("sha256").update(buffer).digest("hex"), parsed.totalRows, parsed.rejected.length, JSON.stringify(parsed.rejected.slice(0, 100)), actor, now);

    const insert = db.prepare(
      `INSERT OR IGNORE INTO transactions (id, client_id, import_id, row_hash, txn_date, merchant, merchant_norm, amount_paise, direction,
         employee, department, category, invoice_no, vendor_gstin, reference, created_at)
       VALUES (@id,@client_id,@import_id,@row_hash,@txn_date,@merchant,@merchant_norm,@amount_paise,@direction,@employee,@department,@category,@invoice_no,@vendor_gstin,@reference,@created_at)`,
    );

    for (const r of parsed.rows) {
      const base = [r.date, r.merchantNorm, r.amountPaise, r.direction, r.employee.toLowerCase(), r.reference.toLowerCase(), r.invoiceNo.toLowerCase()].join("|");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const res = insert.run({
        id: newId(), client_id: clientId, import_id: importId, row_hash: transactionHash(r, n),
        txn_date: r.date, merchant: r.merchant, merchant_norm: r.merchantNorm, amount_paise: r.amountPaise, direction: r.direction,
        employee: r.employee, department: r.department, category: r.category, invoice_no: r.invoiceNo, vendor_gstin: r.vendorGstin,
        reference: r.reference, created_at: now,
      });
      if (res.changes) imported++; else duplicates++;
    }

    db.prepare("UPDATE imports SET rows_imported = ?, rows_duplicate = ? WHERE id = ?").run(imported, duplicates, importId);
    audit({
      actor, action: "import_statement", resource: filename.slice(0, 120), clientId, ip: args.ip,
      details: `Imported ${imported} transactions from ${filename}; ${duplicates} already on file, ${parsed.rejected.length} rejected.`,
    }, db);
  })();

  const analysis = runAnalysis(clientId, actor, db);
  return {
    importId, filename, rowsTotal: parsed.totalRows, imported, duplicates, rejected: parsed.rejected.length,
    credits: parsed.rows.filter((r) => r.direction === "credit").length,
    mapping: parsed.mapping, rejectedRows: parsed.rejected.slice(0, 50), analysis,
  };
}

export function deleteImport(importId: string, clientId: string, actor: string, db: Database.Database = getDb()): AnalysisSummary | null {
  const row = db.prepare("SELECT filename, rows_imported FROM imports WHERE id = ? AND client_id = ?").get(importId, clientId) as { filename: string; rows_imported: number } | undefined;
  if (!row) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM imports WHERE id = ?").run(importId); // cascades to its transactions
    audit({ actor, action: "import_deleted", resource: row.filename, clientId, severity: "warning", details: `Removed import ${row.filename} (${row.rows_imported} transactions).` }, db);
  })();
  return runAnalysis(clientId, actor, db);
}
