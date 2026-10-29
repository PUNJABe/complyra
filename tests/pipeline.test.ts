import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COMPLYRA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "complyra-test-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";

import { openDb } from "@/server/db";
import { createClient, seedDefaultRules } from "@/server/bootstrap";
import { importStatement, deleteImport } from "@/server/imports";
import { runAnalysis } from "@/server/analysis";
import { audit, verifyAudit } from "@/server/audit";
import { parseStatement, ParseError } from "@/server/parser";
import { hashPassword, verifyPassword, signSession, verifySessionToken } from "@/server/auth";

const db = openDb(":memory:");
const sample = fs.readFileSync(path.join(process.cwd(), "sample-data/expenses-q2-fy27.csv"));
const opts = { dayFirst: true, negativeIsDebit: false };
let clientId = "";
let result: Awaited<ReturnType<typeof importStatement>>;

type F = { rule_kind: string; title: string; why: string; status: string; severity: string; id: string };
const findings = async () => await db.prepare("SELECT * FROM findings WHERE client_id = ?").all(clientId) as F[];

beforeAll(async () => {
  clientId = await createClient(db, { name: "Acme Industries" });
  await seedDefaultRules(db, clientId);
  result = await importStatement({ clientId, buffer: sample, filename: "expenses.csv", actor: "tester", opts }, db);
});

describe("import of a realistic statement", () => {
  it("finds the header below preamble lines and maps Indian-style columns", () => {
    expect(result.mapping.date).toBe("Txn Date");
    expect(result.mapping.amount).toBe("Amount (INR)");
    expect(result.mapping.merchant).toBe("Description");
  });
  it("imports good rows, rejects bad ones with reasons, ignores the Total row", () => {
    expect(result.imported).toBe(137);
    expect(result.rejected).toBe(2);
    expect(result.rejectedRows.map((r) => r.reason).join(" | ")).toMatch(/Unrecognised date "31\/02\/2026".*not a number/);
    expect(result.credits).toBe(1);
  });
  it("stores amounts as integer paise and the refund as a credit, not spend", async () => {
    const refund = await db.prepare("SELECT * FROM transactions WHERE merchant = 'Amazon Business' AND direction = 'credit'").get() as { amount_paise: number };
    expect(refund.amount_paise).toBe(249900);
  });
  it("reads DD/MM/YYYY as day-first", async () => {
    const d = await db.prepare("SELECT txn_date FROM transactions WHERE merchant='Apex Laptops India'").get() as { txn_date: string };
    expect(d.txn_date).toBe("2026-09-02");
  });
});

describe("planted violations are found, with explanations", () => {
  const has = async (kind: string, needle: string) => (await findings()).some((f) => f.rule_kind === kind && (f.title + f.why + (f as unknown as { evidence: string }).evidence).toLowerCase().includes(needle.toLowerCase()));
  it("duplicate payment", async () => expect(await has("duplicate_payment", "Swiggy")).toBe(true));
  it("split payments to Zenith that total ₹73,500", async () => expect(await has("split_payment", "₹73,500")).toBe(true));
  it("high-value Apex purchase", async () => expect(await has("amount_over", "Apex")).toBe(true));
  it("prohibited casino and liquor", async () => {
    expect(await has("blocked_keywords", "casino")).toBe(true);
    expect(await has("blocked_keywords", "liquor")).toBe(true);
  });
  it("invalid GSTIN names the real reason", async () => expect(await has("invalid_gstin", "check character")).toBe(true));
  it("does NOT flag valid GSTINs", async () => {
    const bad = (await findings()).filter((f) => f.rule_kind === "invalid_gstin");
    expect(bad).toHaveLength(1);
  });
  it("outlier food expense", async () => expect(await has("outlier", "Barbeque")).toBe(true));
  it("missing invoice for large expense", async () => expect(await has("missing_invoice", "Metro Cash")).toBe(true));
  it("weekend hotel stay", async () => expect(await has("weekend_spend", "Hotel Grand Mercure")).toBe(true));
  it("round-figure advisory fee", async () => expect(await has("round_amount", "Prime Advisory")).toBe(true));
  it("noise stays proportionate (not every row is a finding)", async () => {
    const all = await findings();
    const total = all.length;
    console.log("Findings by rule:", Object.entries(all.reduce<Record<string, number>>((a, f) => ((a[f.rule_kind] = (a[f.rule_kind] ?? 0) + 1), a), {})));
    expect(total).toBeGreaterThan(10);
    expect(total).toBeLessThan(45);
  });
});

describe("idempotency and review workflow", () => {
  it("re-importing the same file adds nothing and does not double count", async () => {
    const before = (await db.prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n;
    const again = await importStatement({ clientId, buffer: sample, filename: "expenses-again.csv", actor: "tester", opts }, db);
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(137);
    expect((await db.prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n).toBe(before);
  });
  it("keeps genuinely identical purchases within one file", async () => {
    const csv = "Date,Merchant,Amount\n01/07/2026,Chai Point,120\n01/07/2026,Chai Point,120\n";
    const c2 = await createClient(db, { name: "Other Co" });
    const r = await importStatement({ clientId: c2, buffer: Buffer.from(csv), filename: "x.csv", actor: "t", opts }, db);
    expect(r.imported).toBe(2);
  });
  it("preserves a reviewer's decision when analysis re-runs", async () => {
    const target = (await findings()).find((f) => f.rule_kind === "amount_over")!;
    await db.prepare("UPDATE findings SET status='dismissed', review_note='Approved by CFO', reviewed_by='cfo@x.com' WHERE id=?").run(target.id);
    await runAnalysis(clientId, "tester", db);
    const after = await db.prepare("SELECT status, review_note FROM findings WHERE id=?").get(target.id) as { status: string; review_note: string };
    expect(after).toEqual({ status: "dismissed", review_note: "Approved by CFO" });
  });
  it("removing an import clears its open findings", async () => {
    const imp = await db.prepare("SELECT id FROM imports WHERE client_id=? ORDER BY created_at LIMIT 1").get(clientId) as { id: string };
    const s = await deleteImport(imp.id, clientId, "tester", db);
    if (!s) throw new Error("expected import removal summary");
    expect(s.removed).toBeGreaterThan(0);
    expect((await db.prepare("SELECT COUNT(*) n FROM transactions WHERE client_id=?").get(clientId) as { n: number }).n).toBe(0);
    // the reviewed finding survives as history
    expect((await findings()).filter((f) => f.status === "dismissed")).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("is intact after all of the above", async () => {
    const v = await verifyAudit(db);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.entries).toBeGreaterThan(5);
  });
  it("cannot be edited or deleted through SQL", async () => {
    await expect(db.prepare("UPDATE audit_log SET actor='mallory' WHERE seq=1").run()).rejects.toThrow(/append-only/);
    await expect(db.prepare("DELETE FROM audit_log WHERE seq=1").run()).rejects.toThrow(/append-only/);
  });
  it("detects tampering even if someone bypasses the triggers (e.g. edits the file)", async () => {
    const d2 = openDb(":memory:");
    for (let i = 0; i < 5; i++) await audit({ actor: "a", action: "x", details: `entry ${i}` }, d2);
    expect((await verifyAudit(d2)).ok).toBe(true);
    d2.exec("DROP TRIGGER audit_log_no_update");
    d2.prepare("UPDATE audit_log SET details='forged' WHERE seq=3").run();
    const v = await verifyAudit(d2);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.brokenAtSeq).toBe(3);
  });
});

describe("authentication primitives", () => {
  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await hashPassword("correct horse 42");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("session tokens are signed: forged, tampered and expired tokens are rejected", () => {
    const t = signSession("user-1");
    expect(verifySessionToken(t)).toEqual({ uid: "user-1" });
    // the original app accepted any base64 JSON — prove that forgery no longer works
    const forged = Buffer.from(JSON.stringify({ uid: "user-1", exp: Date.now() + 1e9 })).toString("base64url") + ".AAAA";
    expect(verifySessionToken(forged)).toBeNull();
    const [body, sig] = t.split(".");
    const evil = Buffer.from(JSON.stringify({ uid: "admin", exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifySessionToken(`${evil}.${sig}`)).toBeNull();
    expect(body).toBeTruthy();
    expect(verifySessionToken(signSession("u", Date.now() - 9 * 3600 * 1000))).toBeNull();
  });
});

describe("parser edge cases", () => {
  it("reads .xlsx including real Date cells and numeric amounts", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Date", "Vendor", "Debit", "Credit", "Employee"]);
    ws.addRow([new Date(Date.UTC(2026, 3, 3)), "Uber", 450.5, null, "Asha"]);
    ws.addRow([new Date(Date.UTC(2026, 3, 4)), "Refund Co", null, 100, "Asha"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseStatement(buf, "s.xlsx", opts);
    expect(r.rows.map((x) => [x.date, x.amountPaise, x.direction])).toEqual([
      ["2026-04-03", 45050, "debit"],
      ["2026-04-04", 10000, "credit"],
    ]);
  });
  it("honours the sign convention switch for single signed amount columns", async () => {
    const csv = Buffer.from("Date,Merchant,Amount\n01/07/2026,A,-500\n02/07/2026,B,300\n");
    const normal = await parseStatement(csv, "a.csv", { dayFirst: true, negativeIsDebit: false });
    const bank = await parseStatement(csv, "a.csv", { dayFirst: true, negativeIsDebit: true });
    expect(normal.rows.map((r) => r.direction)).toEqual(["credit", "debit"]);
    expect(bank.rows.map((r) => r.direction)).toEqual(["debit", "credit"]);
  });
  it("month-first dates when asked", async () => {
    const r = await parseStatement(Buffer.from("Date,Merchant,Amount\n03/04/2026,A,5\n"), "a.csv", { dayFirst: false, negativeIsDebit: false });
    expect(r.rows[0].date).toBe("2026-03-04");
  });
  it("explains unsupported or unreadable files instead of pretending", async () => {
    await expect(parseStatement(Buffer.from("x"), "s.pdf", opts)).rejects.toThrow(/Could not read this PDF|no selectable text/);
    await expect(parseStatement(Buffer.from("x"), "s.xls", opts)).rejects.toThrow(/\.xls/);
    await expect(parseStatement(Buffer.from("not a zip"), "s.xlsx", opts)).rejects.toThrow(ParseError);
    await expect(parseStatement(Buffer.from("a,b\n1,2\n"), "s.csv", opts)).rejects.toThrow(/column headers/);
  });
});
