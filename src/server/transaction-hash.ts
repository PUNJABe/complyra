import { createHash } from "node:crypto";
import type { ParsedRow } from "./parser";

export function transactionHash(row: Pick<ParsedRow, "date" | "merchantNorm" | "amountPaise" | "direction" | "employee" | "reference" | "invoiceNo">, occurrence: number): string {
  const base = [row.date, row.merchantNorm, row.amountPaise, row.direction, row.employee.toLowerCase(), row.reference.toLowerCase(), row.invoiceNo.toLowerCase()].join("|");
  return createHash("sha256").update(`${base}|${occurrence}`).digest("hex");
}
