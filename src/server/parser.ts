import ExcelJS from "exceljs";
import Papa from "papaparse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDate } from "@/lib/dates";
import { parseMoneyToPaise } from "@/lib/money";
import { inferCategory, normaliseMerchant } from "@/lib/merchant";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;

export class ParseError extends Error {}

export type ParseOptions = {
  /** 03/04/2026 means 3 April (India, default) when true; 4 March when false. */
  dayFirst: boolean;
  /** Single signed amount column: true = negative is money out (bank statements); false = negative is a refund. */
  negativeIsDebit: boolean;
};

export type ParsedRow = {
  line: number;
  date: string;
  merchant: string;
  merchantNorm: string;
  amountPaise: number;
  direction: "debit" | "credit";
  employee: string;
  department: string;
  category: string;
  categoryInferred: boolean;
  invoiceNo: string;
  vendorGstin: string;
  reference: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  rejected: { line: number; reason: string }[];
  ignored: number;
  headerLine: number;
  mapping: Record<string, string>;
  totalRows: number;
};

type Cell = unknown;

// ---------- header recognition ----------

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  date: ["date", "transactiondate", "txndate", "postingdate", "valuedate", "transdate", "bookingdate", "expensedate", "tdate"],
  amount: ["amount", "value", "total", "txnamount", "transactionamount", "signedamount", "amountinr", "amt"],
  debit: ["debit", "withdrawal", "withdrawalamt", "withdrawals", "dr", "debitamount", "paidout"],
  credit: ["credit", "deposit", "depositamt", "deposits", "cr", "creditamount", "paidin"],
  type: ["type", "drcr", "crdr", "transactiontype", "txntype"],
  merchant: ["merchant", "merchantname", "vendor", "vendorname", "payee", "counterparty", "beneficiary", "narration", "particulars", "description", "details", "remarks"],
  employee: ["employee", "employeename", "cardholder", "claimant", "submittedby", "paidby", "user", "name"],
  department: ["department", "dept", "costcenter", "costcentre", "team", "businessunit"],
  category: ["category", "expensecategory", "expensetype", "head"],
  invoice: ["invoice", "invoiceno", "invoicenumber", "invoiceid", "billno", "billnumber", "receiptno", "receipt"],
  gstin: ["gstin", "vendorgstin", "suppliergstin", "gstnumber", "gst"],
  reference: ["reference", "refno", "referenceno", "utr", "txnid", "transactionid", "chequeno", "chqrefno", "chequereferenceno"],
};

const FIELD_ORDER = ["date", "amount", "debit", "credit", "type", "merchant", "employee", "department", "category", "invoice", "gstin", "reference"];

function mapHeaders(headers: Cell[]): { map: Record<string, number>; labels: Record<string, string> } {
  const normalised = headers.map(norm);
  const used = new Set<number>();
  const map: Record<string, number> = {};
  const labels: Record<string, string> = {};
  for (const field of FIELD_ORDER) {
    for (const alias of ALIASES[field]) {
      const idx = normalised.findIndex((h, i) => h === alias && !used.has(i));
      if (idx !== -1) {
        map[field] = idx;
        labels[field] = String(headers[idx]).trim();
        used.add(idx);
        break;
      }
    }
  }
  // A leftover free-text description column is still useful as a reference.
  if (map.reference === undefined) {
    const idx = normalised.findIndex((h, i) => !used.has(i) && ["description", "narration", "particulars", "remarks", "details"].includes(h));
    if (idx !== -1) {
      map.reference = idx;
      labels.reference = String(headers[idx]).trim();
    }
  }
  return { map, labels };
}

function looksLikeHeader(map: Record<string, number>): boolean {
  const hasMoney = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;
  return map.date !== undefined && hasMoney && map.merchant !== undefined;
}

// ---------- file → grid ----------

/** Rejects zip bombs before ExcelJS inflates anything: reads sizes from the zip central directory. */
function assertSafeZip(buf: Buffer) {
  const MAX_TOTAL = 120 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new ParseError("This is not a valid .xlsx file.");
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new ParseError("This .xlsx file is corrupted.");
    total += buf.readUInt32LE(offset + 24);
    if (total > MAX_TOTAL) throw new ParseError("This spreadsheet expands to an unreasonable size and was rejected.");
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
}

function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("result" in o) return cellValue(o.result);
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

async function gridFromXlsx(buf: Buffer): Promise<Cell[][]> {
  assertSafeZip(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as never);
  } catch {
    throw new ParseError("Could not read this .xlsx file. Re-save it from Excel and try again.");
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new ParseError("The spreadsheet has no data.");
  if (ws.rowCount > MAX_ROWS + 50) throw new ParseError(`The sheet has more than ${MAX_ROWS.toLocaleString()} rows. Split it and import in parts.`);
  const grid: Cell[][] = Array.from({ length: ws.rowCount }, () => []);
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      grid[n - 1][col - 1] = cellValue(cell.value);
    });
  });
  return grid;
}

function gridFromCsv(buf: Buffer): Cell[][] {
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  if (!res.data.length) throw new ParseError("The file is empty.");
  return res.data;
}

type PdfTextItem = { str: string; transform: number[] };
type PdfWord = { text: string; x: number; y: number };
type PdfLine = PdfWord[];

function pdfLines(items: PdfTextItem[]): PdfLine[] {
  const lines: { y: number; words: PdfWord[] }[] = [];
  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!line) {
      line = { y, words: [] };
      lines.push(line);
    }
    line.words.push({ text, x, y });
  }
  return lines.sort((a, b) => b.y - a.y).map((line) => line.words.sort((a, b) => a.x - b.x));
}

function pdfHeaderField(text: string): string | undefined {
  const value = norm(text);
  return FIELD_ORDER.find((field) => ALIASES[field].includes(value));
}

function isPdfIgnoredColumn(text: string): boolean {
  const value = norm(text);
  return value === "valuedt" || value === "closingbalance" || value === "runningbalance" || value === "availablebalance";
}

function isPdfHeaderLine(line: PdfLine): boolean {
  const values = line.map((word) => pdfHeaderField(word.text));
  return values.includes("date") && values.includes("merchant") &&
    values.some((value) => value === "amount" || value === "debit" || value === "credit");
}

async function gridFromPdf(buf: Buffer): Promise<Cell[][]> {
  let pdf: Awaited<ReturnType<typeof getDocument>["promise"]>;
  try {
    pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  } catch {
    throw new ParseError("Could not read this PDF. The file may be invalid or image-only; upload a valid, text-based statement.");
  }
  const lines: PdfLine[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...pdfLines(content.items.filter((item) => "str" in item && "transform" in item).map((item) => item as PdfTextItem)));
    }
  } catch {
    throw new ParseError("Could not extract text from this PDF. Upload a text-based PDF or export it as CSV or .xlsx.");
  }
  if (!lines.length) throw new ParseError("This PDF has no selectable text. Upload a text-based PDF or export it as CSV or .xlsx.");

  const header = lines.find((line) => {
    const words = line.map((word) => word.text);
    const values = words.map(pdfHeaderField);
    return values.includes("date") && values.some((value) => value === "merchant") &&
      values.some((value) => value === "amount" || value === "debit" || value === "credit");
  });
  if (!header) throw new ParseError("Could not find the column headers in this PDF. It needs date, merchant or description, and amount columns.");

  const anchors = new Map<string, { x: number; label: string }>();
  for (let i = 0; i < header.length; i++) {
    if (isPdfIgnoredColumn(header[i].text)) {
      continue;
    }
    const single = pdfHeaderField(header[i].text);
    if (single && !anchors.has(single)) anchors.set(single, { x: header[i].x, label: header[i].text });
    if (i + 1 < header.length) {
      if (isPdfIgnoredColumn(`${header[i].text}${header[i + 1].text}`)) {
        continue;
      }
      const combined = pdfHeaderField(`${header[i].text}${header[i + 1].text}`);
      if (combined && !anchors.has(combined)) anchors.set(combined, { x: header[i].x, label: `${header[i].text} ${header[i + 1].text}` });
    }
  }
  if (!anchors.has("date") || ![...anchors.keys()].some((field) => ["merchant", "amount", "debit", "credit"].includes(field))) {
    throw new ParseError("Could not map the PDF columns. Export the statement as CSV or .xlsx and try again.");
  }

  const fields = FIELD_ORDER.filter((field) => anchors.has(field)).sort((a, b) => anchors.get(a)!.x - anchors.get(b)!.x);
  const mappedXs = fields.map((field) => anchors.get(field)!.x);
  const ignoredStarts: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (isPdfIgnoredColumn(header[i].text) || (i + 1 < header.length && isPdfIgnoredColumn(`${header[i].text}${header[i + 1].text}`))) {
      ignoredStarts.push(header[i].x);
    }
  }
  const ignoredRanges = ignoredStarts.map((start) => ({
    start,
    end: mappedXs.find((x) => x > start) ?? Number.POSITIVE_INFINITY,
  }));
  const headerRow: Cell[] = FIELD_ORDER.map((field) => anchors.get(field)?.label ?? "");
  const output: Cell[][] = [headerRow];
  let hasTransaction = false;
  for (const line of lines) {
    if (line === header || isPdfHeaderLine(line)) continue;
    const cells = new Map<string, string[]>();
    for (const word of line) {
      if (ignoredRanges.some((range) => word.x >= range.start && word.x < range.end)) continue;
      let best: string | undefined = fields[0];
      for (let i = fields.length - 1; i >= 0; i--) {
        const field = fields[i];
        if (word.x >= anchors.get(field)!.x) {
          best = field;
          break;
        }
      }
      if (best) cells.set(best, [...(cells.get(best) ?? []), word.text]);
    }
    const dateParts = cells.get("date") ?? [];
    const date = dateParts[0] ?? "";
    if (!/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(date)) {
      const previous = output[output.length - 1];
      const merchantIndex = FIELD_ORDER.indexOf("merchant");
      const continuation = [...dateParts, ...(cells.get("merchant") ?? [])].join(" ").trim();
      if (hasTransaction && continuation && previous && previous[merchantIndex]) {
        previous[merchantIndex] = `${previous[merchantIndex]} ${continuation}`.trim();
      }
      continue;
    }
    hasTransaction = true;
    if (dateParts.length > 1) {
      cells.set("merchant", [...dateParts.slice(1), ...(cells.get("merchant") ?? [])]);
    }
    output.push(FIELD_ORDER.map((field) => cells.get(field)?.join(" ") ?? ""));
  }
  return output;
}

// ---------- main ----------

const SUMMARY_ROW = /^(total|grand total|sub ?total|opening balance|closing balance|balance\s*(b\/f|c\/f|brought|carried))/i;

export async function parseStatement(buf: Buffer, filename: string, opts: ParseOptions): Promise<ParseResult> {
  const lower = filename.toLowerCase();
  let grid: Cell[][];
  if (lower.endsWith(".xlsx")) grid = await gridFromXlsx(buf);
  else if (lower.endsWith(".csv") || lower.endsWith(".txt")) grid = gridFromCsv(buf);
  else if (lower.endsWith(".pdf")) grid = await gridFromPdf(buf);
  else if (lower.endsWith(".xls")) throw new ParseError("Old .xls files are not supported. Save the file as .xlsx or .csv and upload again.");
  else throw new ParseError("Upload a .csv, .xlsx, or text-based .pdf file.");

  // Find the header row within the first 15 rows (bank statements often start with account details).
  let headerIdx = -1;
  let mapped: ReturnType<typeof mapHeaders> | null = null;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const m = mapHeaders(grid[i] ?? []);
    if (looksLikeHeader(m.map)) { headerIdx = i; mapped = m; break; }
  }
  if (headerIdx === -1 || !mapped) {
    const seen = (grid[0] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 12).join(", ") || "none";
    throw new ParseError(
      `Could not find the column headers. The file needs a date column, a merchant or description column, and an amount (or debit/credit) column. First row reads: ${seen}.`,
    );
  }

  const { map, labels } = mapped;
  const dataRows = grid.slice(headerIdx + 1);
  if (dataRows.length > MAX_ROWS) throw new ParseError(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Split it and import in parts.`);

  const rows: ParsedRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  let ignored = 0;
  const get = (r: Cell[], f: string) => (map[f] === undefined ? null : r[map[f]] ?? null);
  const text = (r: Cell[], f: string) => String(get(r, f) ?? "").trim();

  dataRows.forEach((r, i) => {
    const line = headerIdx + 2 + i;
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === "")) return;

    const merchant = text(r, "merchant");
    // Footers put "Total" / "Closing balance" in whichever column comes first, so check both.
    if (SUMMARY_ROW.test(merchant) || SUMMARY_ROW.test(text(r, "date")) || (!merchant && get(r, "date") === null)) { ignored++; return; }

    const date = parseDate(get(r, "date"), { dayFirst: opts.dayFirst });
    if (!date) {
      rejected.push({ line, reason: `Unrecognised date "${String(get(r, "date") ?? "").trim()}"` });
      return;
    }
    if (!merchant) { rejected.push({ line, reason: "Missing merchant or description" }); return; }

    // Amount and direction
    let amountPaise: number | null = null;
    let direction: "debit" | "credit" = "debit";
    const deb = map.debit !== undefined ? parseMoneyToPaise(get(r, "debit")) : null;
    const cred = map.credit !== undefined ? parseMoneyToPaise(get(r, "credit")) : null;
    const debV = deb && deb.paise !== 0 ? Math.abs(deb.paise) : 0;
    const credV = cred && cred.paise !== 0 ? Math.abs(cred.paise) : 0;

    if (debV || credV) {
      if (debV && credV) { rejected.push({ line, reason: "Both debit and credit are filled" }); return; }
      amountPaise = debV || credV;
      direction = debV ? "debit" : "credit";
    } else if (map.amount !== undefined) {
      const raw = get(r, "amount");
      const a = parseMoneyToPaise(raw);
      if (!a) { rejected.push({ line, reason: raw === null || raw === "" ? "Missing amount" : `Amount "${String(raw).trim()}" is not a number` }); return; }
      const typeText = text(r, "type").toLowerCase();
      const marker = a.marker ?? (/^(cr|credit)\b/.test(typeText) ? "cr" : /^(dr|debit)\b/.test(typeText) ? "dr" : undefined);
      amountPaise = Math.abs(a.paise);
      if (marker) direction = marker === "cr" ? "credit" : "debit";
      else if (a.paise < 0) direction = opts.negativeIsDebit ? "debit" : "credit";
      else direction = opts.negativeIsDebit ? "credit" : "debit";
    } else {
      rejected.push({ line, reason: "Missing amount" });
      return;
    }
    if (!amountPaise) { rejected.push({ line, reason: "Zero amount" }); return; }

    const merchantNorm = normaliseMerchant(merchant);
    const fileCategory = text(r, "category") || (map.type !== undefined && !/^(dr|cr|debit|credit)\b/i.test(text(r, "type")) ? text(r, "type") : "");
    const category = fileCategory || inferCategory(merchantNorm);

    rows.push({
      line, date, merchant, merchantNorm, amountPaise, direction,
      employee: text(r, "employee"),
      department: text(r, "department"),
      category,
      categoryInferred: !fileCategory,
      invoiceNo: text(r, "invoice"),
      vendorGstin: text(r, "gstin").toUpperCase().replace(/\s/g, ""),
      reference: text(r, "reference"),
    });
  });

  return {
    rows, rejected, ignored, headerLine: headerIdx + 1,
    mapping: labels, totalRows: rows.length + rejected.length + ignored,
  };
}
